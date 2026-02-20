import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, type Message, type GuildTextBasedChannel } from 'discord.js';
import type { VoiceConnection } from '@discordjs/voice';
import { VoiceHandler } from './voiceHandler.js';
import 'tweetnacl';

// @discordjs/voice の暗号化に tweetnacl を使用
console.log('✅ tweetnacl を初期化しました');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

const voiceHandlers = new Collection<string, VoiceHandler>();
const voiceConnections = new Collection<string, VoiceConnection>();

client.on('ready', () => {
  const user = client.user!;
  const displayName = user.globalName ?? user.tag ?? user.username;
  console.log(`✅ ボット起動: ${displayName}`);
  console.log(`   接続中のギルド数: ${client.guilds.cache.size}`);
});

client.on('messageCreate', async (message: Message) => {
  console.log(`📨 メッセージ受信: ${message.author.username}: ${message.content}`);

  if (message.author.bot) {
    console.log(`   → bot のメッセージ、スキップ`);
    return;
  }
  if (!message.content.startsWith('!')) {
    console.log(`   → コマンド形式ではない、スキップ`);
    return;
  }
  if (!message.guild) return;

  const args = message.content.slice(1).split(/\s+/);
  const command = args.shift()!.toLowerCase();
  console.log(`🔧 コマンド実行: ${command}, 引数: ${JSON.stringify(args)}`);

  const guildId = message.guild.id;
  if (!voiceHandlers.has(guildId)) {
    voiceHandlers.set(guildId, new VoiceHandler());
  }
  const handler = voiceHandlers.get(guildId)!;

  switch (command) {
    case 'join':
      await handleJoin(message, handler);
      break;
    case 'leave':
      await handleLeave(message, handler, guildId);
      break;
    case 'record':
      await handleRecord(message, handler, args, guildId);
      break;
    case 'status':
      await handleStatus(message, handler);
      break;
    case 'help':
      await handleHelp(message);
      break;
  }
});

async function handleJoin(message: Message, handler: VoiceHandler): Promise<void> {
  try {
    const member = message.member;
    const guildId = message.guild!.id;

    if (!member?.voice?.channel) {
      await message.reply('❌ あなたはボイスチャネルに接続していません');
      return;
    }

    if (voiceConnections.has(guildId)) {
      await message.reply('⚠️ 既にボイスチャネルに接続しています');
      return;
    }

    console.log(`🔄 join コマンド実行: ${member.user.username} -> ${member.voice.channel.name}`);

    const connection = await handler.connectToVoiceChannel(member);
    if (!connection) {
      console.error(`❌ connectToVoiceChannel が null を返しました`);
      await message.reply('❌ ボイスチャネルへの接続に失敗しました');
      return;
    }

    voiceConnections.set(guildId, connection);
    await handler.startRecording(connection, message.channel as GuildTextBasedChannel);

    await message.reply(
      `✅ ${member.voice.channel.name} に接続しました\n🎙️ 議事録の記録を開始します`
    );
  } catch (error) {
    console.error('❌ join エラー:', error);
    await message.reply(`❌ エラーが発生しました: ${error instanceof Error ? error.message : error}`);
  }
}

async function handleLeave(message: Message, handler: VoiceHandler, guildId: string): Promise<void> {
  try {
    if (!voiceConnections.has(guildId)) {
      await message.reply('❌ ボイスチャネルに接続していません');
      return;
    }

    await handler.stopRecording();
    voiceConnections.delete(guildId);

    await message.reply(
      `✅ ボイスチャネルから切断しました\n📄 議事録が Scrapbox に保存されました`
    );

    if (handler.currentPageTitle) {
      const pageUrl = handler.scrapbox.getPageUrl(handler.currentPageTitle);
      await message.reply(`📎 ${pageUrl}`);
    }
  } catch (error) {
    console.error('❌ leave エラー:', error);
    await message.reply(`❌ エラーが発生しました: ${error instanceof Error ? error.message : error}`);
  }
}

async function handleRecord(message: Message, handler: VoiceHandler, args: string[], guildId: string): Promise<void> {
  try {
    const action = args[0]?.toLowerCase();

    if (action === 'start') {
      const member = message.member;

      if (!member?.voice?.channel) {
        await message.reply('❌ あなたはボイスチャネルに接続していません');
        return;
      }

      if (voiceConnections.has(guildId)) {
        await message.reply('⚠️ 既に記録中です。先に `!record stop` で停止してください');
        return;
      }

      console.log(`🔄 record start コマンド実行: ${member.user.username}`);

      const connection = await handler.connectToVoiceChannel(member);
      if (!connection) {
        console.error(`❌ connectToVoiceChannel が null を返しました`);
        await message.reply('❌ ボイスチャネルへの接続に失敗しました\n詳細はコンソールを確認してください');
        return;
      }

      voiceConnections.set(guildId, connection);
      await handler.startRecording(connection, message.channel as GuildTextBasedChannel);
      await message.reply('🎙️ 議事録の記録を開始しました');
    } else if (action === 'stop') {
      if (!voiceConnections.has(guildId)) {
        await message.reply('❌ 現在記録中ではありません');
        return;
      }

      await handler.stopRecording();
      voiceConnections.delete(guildId);

      await message.reply('✅ 記録を停止しました\n📄 議事録が Scrapbox に保存されました');

      if (handler.currentPageTitle) {
        const pageUrl = handler.scrapbox.getPageUrl(handler.currentPageTitle);
        await message.reply(`📎 ${pageUrl}`);
      }
    } else {
      await message.reply('❌ コマンド形式: `!record start` または `!record stop`');
    }
  } catch (error) {
    console.error('❌ record エラー:', error);
    await message.reply(`❌ エラーが発生しました: ${error instanceof Error ? error.message : error}`);
  }
}

async function handleStatus(message: Message, handler: VoiceHandler): Promise<void> {
  try {
    const guildId = message.guild!.id;
    let statusText: string;

    if (voiceConnections.has(guildId) && handler.recording) {
      const duration = (Date.now() - handler.sessionStartTime!.getTime()) / 1000;
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);

      statusText = `🎙️ 記録中\n記録時間: ${minutes}分 ${seconds}秒`;
    } else {
      statusText = '⏹️ 記録停止中';
    }

    await message.reply(statusText);
  } catch (error) {
    console.error('❌ status エラー:', error);
    await message.reply(`❌ エラーが発生しました: ${error instanceof Error ? error.message : error}`);
  }
}

async function handleHelp(message: Message): Promise<void> {
  const helpText = `
📖 Discord 議事録ボット コマンド一覧

\`!join\` - ボイスチャネルに接続（記録開始）
\`!leave\` - ボイスチャネルから切断（記録停止）
\`!record start\` - 記録を開始
\`!record stop\` - 記録を停止
\`!status\` - 現在の記録状態を表示
\`!help\` - このメッセージを表示

📝 使用方法：
1. ボイスチャネルに参加
2. \`!join\` で接続
3. 会議・ミーティングを実施
4. \`!leave\` で終了 → 議事録が自動保存
  `;

  await message.reply(helpText);
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN が .env に設定されていません');
  process.exit(1);
}

client.login(token);
