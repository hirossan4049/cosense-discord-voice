import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType
} from '@discordjs/voice';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import prism from 'prism-media';
import { WhisperClient } from './whisperClient.js';
import { ScrapboxWriter } from './scrapboxWriter.js';

export class VoiceHandler {
  constructor() {
    this.recording = false;
    this.whisper = new WhisperClient();
    this.scrapbox = new ScrapboxWriter();
    this.recordingDir = path.join(process.cwd(), 'recordings');
    this.ensureRecordingDir();

    this.sessionStartTime = null;
    this.currentPageTitle = null;
    this.voiceConnection = null;
    this.audioRecorder = null;
    this.userAudioFiles = {}; // userID -> file stream map
    this.textChannel = null; // ボイスチャネルのテキストチャンネル
    this.pendingTranscriptions = []; // 処理中の文字起こし Promise
  }

  ensureRecordingDir() {
    if (!fs.existsSync(this.recordingDir)) {
      fs.mkdirSync(this.recordingDir, { recursive: true });
    }
  }

  /**
   * メンバーが属するボイスチャネルに接続
   * @param {discord.GuildMember} member - Discord メンバー
   * @returns {Promise<VoiceConnection|null>}
   */
  async connectToVoiceChannel(member) {
    try {
      if (!member.voice?.channel) {
        throw new Error('メンバーはボイスチャネルに接続していません');
      }

      const channel = member.voice.channel;
      console.log(`🎤 ボイスチャネルに接続: ${channel.name}`);

      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false
      });

      // 接続状態を待つ
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      this.voiceConnection = connection;
      console.log(`✅ ボイスチャネル接続成功`);
      return connection;
    } catch (error) {
      console.error(`❌ ボイスチャネル接続失敗:`, error);
      return null;
    }
  }

  /**
   * 音声記録を開始
   * @param {VoiceConnection} connection
   * @param {discord.TextChannel} textChannel - 議事録を投稿するテキストチャンネル
   */
  async startRecording(connection, textChannel) {
    this.recording = true;
    this.sessionStartTime = new Date();
    this.currentPageTitle = this.scrapbox.createMinutesPage();
    this.userAudioFiles = {};
    this.textChannel = textChannel; // テキストチャンネルを保存

    // Scrapbox ページを初期化
    const header = `議事録\n開始時刻: ${this.sessionStartTime.toLocaleString('ja-JP')}\n\n`;
    await this.scrapbox.appendToPage(this.currentPageTitle, header);

    console.log(`🎙️ 録音開始: ${this.currentPageTitle}`);

    // ffmpeg で音声をストリーム処理
    this._startFFmpegCapture(connection);
  }

  /**
   * ffmpeg でボイスチャネルの音声をキャプチャ
   * @param {VoiceConnection} connection
   */
  _startFFmpegCapture(connection) {
    // receiver で各ユーザーの音声ストリームを取得
    // （discord.js v14 では connection.receiver が使用可能）

    if (connection.receiver) {
      console.log(`🔊 音声受信開始...`);

      // 全ユーザーの音声イベントをリッスン
      connection.receiver.speaking.on('start', (userId) => {
        if (!this.userAudioFiles[userId]) {
          console.log(`🎤 ユーザー ${userId} を録音開始`);
        }
        this._recordUserAudio(connection, userId);
      });
    } else {
      console.warn('⚠️ connection.receiver が利用不可（discord.js バージョンを確認）');
    }
  }

  /**
   * ユーザーの音声をファイルに記録
   * @param {VoiceConnection} connection
   * @param {string} userId
   */
  _recordUserAudio(connection, userId) {
    if (this.userAudioFiles[userId]) {
      return; // 既に記録中
    }

    try {
      const datePrefix = this.sessionStartTime.toISOString().split('T')[0];
      const uniqueSuffix = Date.now();
      const audioFile = path.join(
        this.recordingDir,
        `voice_${datePrefix}_${uniqueSuffix}_${userId}.mp3`
      );

      console.log(`📝 ユーザー ${userId} の音声を記録: ${audioFile}`);

      // receiver.subscribe() で Opus ストリームを取得（新API）
      const opusStream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1200
        }
      });

      // Opus → PCM にデコード（チャンネル数を1に変更）
      const decoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960
      });
      const pcmStream = opusStream.pipe(decoder);

      // ffmpeg で PCM → MP3 に変換
      const ffmpeg = spawn('ffmpeg', [
        '-y', // 上書き確認を抑止
        '-loglevel', 'error',
        '-f', 's16le', // 入力フォーマット (PCM)
        '-ar', '48000',
        '-ac', '2',
        '-i', 'pipe:0',
        '-acodec', 'libmp3lame',
        '-q:a', '6',
        audioFile
      ]);

      let ffmpegError = '';
      ffmpeg.stderr.on('data', (data) => {
        ffmpegError += data.toString();
      });

      pcmStream.pipe(ffmpeg.stdin);

      const handleStreamError = (label) => (err) => {
        console.error(`❌ ${label} エラー (${userId}):`, err.message);
      };
      opusStream.on('error', handleStreamError('Opus stream'));
      decoder.on('error', handleStreamError('PCM decode'));
      ffmpeg.stdin.on('error', handleStreamError('ffmpeg stdin'));

      ffmpeg.on('close', (code, signal) => {
        const exists = fs.existsSync(audioFile);
        console.log(
          `✅ ユーザー ${userId} の音声記録完了 (code=${code}, signal=${signal}, file=${exists ? 'ok' : 'missing'})`
        );
        if (!exists && ffmpegError) {
          console.error(`ffmpeg stderr: ${ffmpegError.trim()}`);
        }
        delete this.userAudioFiles[userId];

        // 発話終了ごとに即座に Whisper へ送信
        if (exists) {
          const p = this._transcribeAndPost(audioFile, userId);
          this.pendingTranscriptions.push(p);
          p.finally(() => {
            const idx = this.pendingTranscriptions.indexOf(p);
            if (idx !== -1) this.pendingTranscriptions.splice(idx, 1);
          });
        }
      });

      opusStream.on('end', () => {
        console.log(`🔇 ユーザー ${userId} のストリーム終了`);
      });

      this.userAudioFiles[userId] = ffmpeg;
    } catch (error) {
      console.error(`❌ ユーザー ${userId} の記録エラー:`, error.message);
    }
  }

  /**
   * 音声記録を停止
   */
  async stopRecording() {
    if (!this.recording) {
      return;
    }

    this.recording = false;

    // 全ユーザーの記録を終了
    const closeWaiters = [];
    for (const ffmpeg of Object.values(this.userAudioFiles)) {
      if (!ffmpeg) {
        continue;
      }

      // すでに終了している場合はスキップ
      if (ffmpeg.exitCode !== null || ffmpeg.signalCode !== null) {
        continue;
      }

      // close イベントを待ってから後続処理へ進む
      closeWaiters.push(
        new Promise((resolve) => {
          ffmpeg.once('close', () => resolve());
          ffmpeg.once('error', () => resolve());
        })
      );

      if (!ffmpeg.killed) {
        ffmpeg.kill();
      }
    }
    if (closeWaiters.length) {
      await Promise.all(closeWaiters);
    }

    // ボイス接続を切断
    if (this.voiceConnection) {
      this.voiceConnection.destroy();
      console.log('🎤 ボイスチャネルから切断');
    }

    // 処理中の文字起こしが完了するのを待つ
    if (this.pendingTranscriptions.length > 0) {
      console.log(`🔄 残りの文字起こし ${this.pendingTranscriptions.length} 件を待機中...`);
      await Promise.all(this.pendingTranscriptions);
    }

    // Scrapbox URL をテキストチャンネルに投稿
    if (this.textChannel && this.currentPageTitle) {
      const pageUrl = this.scrapbox.getPageUrl(this.currentPageTitle);
      await this.textChannel.send(`📎 議事録: ${pageUrl}`);
    }

    console.log('✅ 全ファイルの処理完了');
  }

  /**
   * 発話ごとに Whisper で認識し Scrapbox / Discord に投稿
   * @param {string} audioFile - 音声ファイルパス
   * @param {string} userId - Discord ユーザー ID
   */
  async _transcribeAndPost(audioFile, userId) {
    try {
      // ファイルサイズチェック（空ファイルをスキップ）
      const stats = fs.statSync(audioFile);
      if (stats.size === 0) {
        console.log(`⚠️ 空ファイルのためスキップ: ${path.basename(audioFile)}`);
        fs.unlinkSync(audioFile);
        return;
      }

      const text = await this.whisper.transcribe(audioFile);

      if (text) {
        // ギルドメンバーのニックネームを取得（なければユーザー名、それも無ければID）
        let userName = `User_${userId}`;
        try {
          const member = await this.textChannel?.guild?.members.fetch(userId);
          if (member) {
            userName = member.displayName;
          }
        } catch {}

        const entry = this.scrapbox.formatMinutesEntry(userName, text);
        await this.scrapbox.appendToPage(this.currentPageTitle, entry);
        console.log(`✅ ${userName}: ${text.substring(0, 50)}...`);

        // テキストチャンネルにリアルタイム投稿
        if (this.textChannel) {
          await this.textChannel.send(`**${userName}:** ${text}`);
        }
      }

      // ファイルを削除
      fs.unlinkSync(audioFile);
    } catch (error) {
      console.error(`❌ リアルタイム文字起こしエラー (${userId}):`, error.message);
      // エラーでもファイルは削除
      try { fs.unlinkSync(audioFile); } catch {}
    }
  }
}
