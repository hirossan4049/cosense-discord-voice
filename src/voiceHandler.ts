import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
  type VoiceConnection,
} from '@discordjs/voice';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import prism from 'prism-media';
import type { GuildMember, GuildTextBasedChannel } from 'discord.js';
import { WhisperClient } from './whisperClient.js';
import { ScrapboxWriter } from './scrapboxWriter.js';

export class VoiceHandler {
  recording = false;
  whisper: WhisperClient;
  scrapbox: ScrapboxWriter;
  recordingDir: string;
  sessionStartTime: Date | null = null;
  currentPageTitle: string | null = null;
  voiceConnection: VoiceConnection | null = null;
  userAudioFiles: Record<string, ChildProcess> = {};
  textChannel: GuildTextBasedChannel | null = null;
  pendingTranscriptions: Promise<void>[] = [];

  constructor() {
    this.whisper = new WhisperClient();
    this.scrapbox = new ScrapboxWriter();
    this.recordingDir = path.join(process.cwd(), 'recordings');
    this.ensureRecordingDir();
  }

  ensureRecordingDir(): void {
    if (!fs.existsSync(this.recordingDir)) {
      fs.mkdirSync(this.recordingDir, { recursive: true });
    }
  }

  async connectToVoiceChannel(member: GuildMember): Promise<VoiceConnection | null> {
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

      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      this.voiceConnection = connection;
      console.log(`✅ ボイスチャネル接続成功`);
      return connection;
    } catch (error) {
      console.error(`❌ ボイスチャネル接続失敗:`, error);
      return null;
    }
  }

  async startRecording(connection: VoiceConnection, textChannel: GuildTextBasedChannel): Promise<void> {
    this.recording = true;
    this.sessionStartTime = new Date();
    this.currentPageTitle = this.scrapbox.createMinutesPage();
    this.userAudioFiles = {};
    this.textChannel = textChannel;

    const header = `議事録\n開始時刻: ${this.sessionStartTime.toLocaleString('ja-JP')}\n\n`;
    await this.scrapbox.appendToPage(this.currentPageTitle, header);

    console.log(`🎙️ 録音開始: ${this.currentPageTitle}`);

    this._startFFmpegCapture(connection);
  }

  private _startFFmpegCapture(connection: VoiceConnection): void {
    if (connection.receiver) {
      console.log(`🔊 音声受信開始...`);

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

  private _recordUserAudio(connection: VoiceConnection, userId: string): void {
    if (this.userAudioFiles[userId]) {
      return;
    }

    try {
      const datePrefix = this.sessionStartTime!.toISOString().split('T')[0];
      const uniqueSuffix = Date.now();
      const audioFile = path.join(
        this.recordingDir,
        `voice_${datePrefix}_${uniqueSuffix}_${userId}.mp3`
      );

      console.log(`📝 ユーザー ${userId} の音声を記録: ${audioFile}`);

      const opusStream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1200
        }
      });

      const decoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960
      });
      const pcmStream = opusStream.pipe(decoder);

      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-loglevel', 'error',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-i', 'pipe:0',
        '-acodec', 'libmp3lame',
        '-q:a', '6',
        audioFile
      ]);

      let ffmpegError = '';
      ffmpeg.stderr!.on('data', (data: Buffer) => {
        ffmpegError += data.toString();
      });

      pcmStream.pipe(ffmpeg.stdin!);

      const handleStreamError = (label: string) => (err: Error) => {
        console.error(`❌ ${label} エラー (${userId}):`, err.message);
      };
      opusStream.on('error', handleStreamError('Opus stream'));
      decoder.on('error', handleStreamError('PCM decode'));
      ffmpeg.stdin!.on('error', handleStreamError('ffmpeg stdin'));

      ffmpeg.on('close', (code, signal) => {
        const exists = fs.existsSync(audioFile);
        console.log(
          `✅ ユーザー ${userId} の音声記録完了 (code=${code}, signal=${signal}, file=${exists ? 'ok' : 'missing'})`
        );
        if (!exists && ffmpegError) {
          console.error(`ffmpeg stderr: ${ffmpegError.trim()}`);
        }
        delete this.userAudioFiles[userId];

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
      console.error(`❌ ユーザー ${userId} の記録エラー:`, error instanceof Error ? error.message : error);
    }
  }

  async stopRecording(): Promise<void> {
    if (!this.recording) {
      return;
    }

    this.recording = false;

    const closeWaiters: Promise<void>[] = [];
    for (const ffmpeg of Object.values(this.userAudioFiles)) {
      if (!ffmpeg) continue;
      if (ffmpeg.exitCode !== null || ffmpeg.signalCode !== null) continue;

      closeWaiters.push(
        new Promise<void>((resolve) => {
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

    if (this.voiceConnection) {
      this.voiceConnection.destroy();
      console.log('🎤 ボイスチャネルから切断');
    }

    if (this.pendingTranscriptions.length > 0) {
      console.log(`🔄 残りの文字起こし ${this.pendingTranscriptions.length} 件を待機中...`);
      await Promise.all(this.pendingTranscriptions);
    }

    if (this.textChannel && this.currentPageTitle) {
      const pageUrl = this.scrapbox.getPageUrl(this.currentPageTitle);
      await this.textChannel.send(`📎 議事録: ${pageUrl}`);
    }

    console.log('✅ 全ファイルの処理完了');
  }

  private async _transcribeAndPost(audioFile: string, userId: string): Promise<void> {
    try {
      const stats = fs.statSync(audioFile);
      if (stats.size === 0) {
        console.log(`⚠️ 空ファイルのためスキップ: ${path.basename(audioFile)}`);
        fs.unlinkSync(audioFile);
        return;
      }

      const text = await this.whisper.transcribe(audioFile);

      if (text) {
        let userName = `User_${userId}`;
        try {
          const guild = this.textChannel && 'guild' in this.textChannel ? this.textChannel.guild : null;
          const member = await guild?.members.fetch(userId);
          if (member) {
            userName = member.displayName;
          }
        } catch { /* ignore */ }

        const entry = this.scrapbox.formatMinutesEntry(userName, text);
        await this.scrapbox.appendToPage(this.currentPageTitle!, entry);
        console.log(`✅ ${userName}: ${text.substring(0, 50)}...`);

        if (this.textChannel) {
          await this.textChannel.send(`**${userName}:** ${text}`);
        }
      }

      fs.unlinkSync(audioFile);
    } catch (error) {
      console.error(`❌ リアルタイム文字起こしエラー (${userId}):`, error instanceof Error ? error.message : error);
      try { fs.unlinkSync(audioFile); } catch { /* ignore */ }
    }
  }
}
