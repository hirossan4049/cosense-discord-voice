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

    // 音声認識を実行
    await this._processRecordings();
  }

  /**
   * 録音ファイルを処理・Whisper で認識
   */
  async _processRecordings() {
    try {
      console.log('🔄 音声認識を開始...');

      const files = fs.readdirSync(this.recordingDir);
      const datePrefix = this.sessionStartTime.toISOString().split('T')[0];
      const recordingPattern = new RegExp(
        `voice_${datePrefix}_\\d+_\\d+\\.mp3`
      );
      const userFiles = files.filter((f) => recordingPattern.test(f));

      if (userFiles.length === 0) {
        console.log('⚠️ 音声ファイルがありません');
        return;
      }

      // テキストチャンネルに投稿するメッセージを構築
      let channelMessage = `📝 **議事録** - ${this.sessionStartTime.toLocaleTimeString('ja-JP', { hour12: false })}\n\n`;
      let hasContent = false;

      // ユーザーごとに認識
      for (const fileName of userFiles) {
        const filePath = path.join(this.recordingDir, fileName);
        const userId = fileName.match(/_(\d+)\\.mp3$/)?.[1] ?? 'unknown'; // ファイル名から userID 抽出

        try {
          // ファイルの存在チェック
          if (!fs.existsSync(filePath)) {
            console.log(`⚠️ ファイルが存在しないためスキップ: ${fileName}`);
            continue;
          }

          // ファイルサイズチェック（空ファイルをスキップ）
          const stats = fs.statSync(filePath);
          if (stats.size === 0) {
            console.log(`⚠️ 空ファイルのためスキップ: ${fileName}`);
            fs.unlinkSync(filePath);
            continue;
          }

          const text = await this.whisper.transcribe(filePath);

          if (text) {
            // Scrapbox に書き込む
            const userName = `User_${userId}`;
            const entry = this.scrapbox.formatMinutesEntry(userName, text);
            await this.scrapbox.appendToPage(this.currentPageTitle, entry);
            console.log(`✅ ${userName}: ${text.substring(0, 50)}...`);

            // チャンネルメッセージに追加
            channelMessage += `**${userName}:** ${text}\n`;
            hasContent = true;
          }

          // ファイルを削除
          fs.unlinkSync(filePath);
        } catch (error) {
          console.error(`❌ ファイル処理エラー (${fileName}):`, error.message);
        }
      }

      // テキストチャンネルに投稿
      if (this.textChannel && hasContent) {
        const pageUrl = this.scrapbox.getPageUrl(this.currentPageTitle);
        channelMessage += `\n📎 [Scrapbox で確認](${pageUrl})`;
        await this.textChannel.send(channelMessage);
        console.log(`✅ チャンネルに投稿しました`);
      }

      console.log('✅ 全ファイルの処理完了');
    } catch (error) {
      console.error('❌ 処理エラー:', error.message);
    }
  }
}
