import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Collection,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import type { VoiceConnection } from '@discordjs/voice';
import { VoiceHandler } from './voiceHandler.js';
import 'tweetnacl';

// @discordjs/voice の暗号化に tweetnacl を使用
console.log('✅ tweetnacl を初期化しました');

const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('ボイスチャネルに接続して議事録の記録を開始します')
    .addStringOption(option =>
      option.setName('project')
        .setDescription('Cosenseプロジェクト名（省略時は.envの設定を使用）')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('ボイスチャネルから切断して議事録の記録を停止します'),
  new SlashCommandBuilder()
    .setName('record')
    .setDescription('議事録の記録を制御します')
    .addSubcommand(sub =>
      sub.setName('start').setDescription('議事録の記録を開始します')
    )
    .addSubcommand(sub =>
      sub.setName('stop').setDescription('議事録の記録を停止します')
    ),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('現在の記録状態を表示します'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('コマンド一覧を表示します'),
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ]
});

const voiceHandlers = new Collection<string, VoiceHandler>();
const voiceConnections = new Collection<string, VoiceConnection>();

client.on('clientReady', async () => {
  const user = client.user!;
  const displayName = user.globalName ?? user.tag ?? user.username;
  console.log(`✅ ボット起動: ${displayName}`);
  console.log(`   接続中のギルド数: ${client.guilds.cache.size}`);

  await client.application!.commands.set(commands);
  console.log('✅ スラッシュコマンドを登録しました');
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  const guildId = interaction.guild.id;
  if (!voiceHandlers.has(guildId)) {
    voiceHandlers.set(guildId, new VoiceHandler());
  }
  const handler = voiceHandlers.get(guildId)!;

  switch (interaction.commandName) {
    case 'join':
      await handleJoin(interaction, handler);
      break;
    case 'leave':
      await handleLeave(interaction, handler, guildId);
      break;
    case 'record':
      await handleRecord(interaction, handler, guildId);
      break;
    case 'status':
      await handleStatus(interaction, handler);
      break;
    case 'help':
      await handleHelp(interaction);
      break;
  }
});

async function handleJoin(interaction: ChatInputCommandInteraction, handler: VoiceHandler): Promise<void> {
  try {
    const member = interaction.member as GuildMember;
    const guildId = interaction.guild!.id;

    if (!member?.voice?.channel) {
      await interaction.reply('❌ あなたはボイスチャネルに接続していません');
      return;
    }

    if (voiceConnections.has(guildId)) {
      await interaction.reply('⚠️ 既にボイスチャネルに接続しています');
      return;
    }

    await interaction.deferReply();

    const projectName = interaction.options.getString('project');
    if (projectName) {
      handler.scrapbox.setProjectName(projectName);
    }

    console.log(`🔄 join コマンド実行: ${member.user.username} -> ${member.voice.channel.name}`);

    const connection = await handler.connectToVoiceChannel(member);
    if (!connection) {
      console.error(`❌ connectToVoiceChannel が null を返しました`);
      await interaction.editReply('❌ ボイスチャネルへの接続に失敗しました');
      return;
    }

    voiceConnections.set(guildId, connection);
    await handler.startRecording(connection, interaction.channel as GuildTextBasedChannel);

    const projectInfo = projectName ? ` (プロジェクト: ${projectName})` : '';
    await interaction.editReply(
      `✅ ${member.voice.channel.name} に接続しました\n🎙️ 議事録の記録を開始します${projectInfo}`
    );
  } catch (error) {
    console.error('❌ join エラー:', error);
    const msg = `❌ エラーが発生しました: ${error instanceof Error ? error.message : error}`;
    if (interaction.deferred) {
      await interaction.editReply(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}

async function handleLeave(interaction: ChatInputCommandInteraction, handler: VoiceHandler, guildId: string): Promise<void> {
  try {
    if (!voiceConnections.has(guildId)) {
      await interaction.reply('❌ ボイスチャネルに接続していません');
      return;
    }

    await interaction.deferReply();

    await handler.stopRecording();
    voiceConnections.delete(guildId);

    let replyText = '✅ ボイスチャネルから切断しました\n📄 議事録が Scrapbox に保存されました';
    if (handler.currentPageTitle) {
      const pageUrl = handler.scrapbox.getPageUrl(handler.currentPageTitle);
      replyText += `\n📎 ${pageUrl}`;
    }

    await interaction.editReply(replyText);
  } catch (error) {
    console.error('❌ leave エラー:', error);
    const msg = `❌ エラーが発生しました: ${error instanceof Error ? error.message : error}`;
    if (interaction.deferred) {
      await interaction.editReply(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}

async function handleRecord(interaction: ChatInputCommandInteraction, handler: VoiceHandler, guildId: string): Promise<void> {
  try {
    const action = interaction.options.getSubcommand();

    if (action === 'start') {
      const member = interaction.member as GuildMember;

      if (!member?.voice?.channel) {
        await interaction.reply('❌ あなたはボイスチャネルに接続していません');
        return;
      }

      if (voiceConnections.has(guildId)) {
        await interaction.reply('⚠️ 既に記録中です。先に `/record stop` で停止してください');
        return;
      }

      await interaction.deferReply();
      console.log(`🔄 record start コマンド実行: ${member.user.username}`);

      const connection = await handler.connectToVoiceChannel(member);
      if (!connection) {
        console.error(`❌ connectToVoiceChannel が null を返しました`);
        await interaction.editReply('❌ ボイスチャネルへの接続に失敗しました\n詳細はコンソールを確認してください');
        return;
      }

      voiceConnections.set(guildId, connection);
      await handler.startRecording(connection, interaction.channel as GuildTextBasedChannel);
      await interaction.editReply('🎙️ 議事録の記録を開始しました');
    } else if (action === 'stop') {
      if (!voiceConnections.has(guildId)) {
        await interaction.reply('❌ 現在記録中ではありません');
        return;
      }

      await interaction.deferReply();

      await handler.stopRecording();
      voiceConnections.delete(guildId);

      let replyText = '✅ 記録を停止しました\n📄 議事録が Scrapbox に保存されました';
      if (handler.currentPageTitle) {
        const pageUrl = handler.scrapbox.getPageUrl(handler.currentPageTitle);
        replyText += `\n📎 ${pageUrl}`;
      }

      await interaction.editReply(replyText);
    }
  } catch (error) {
    console.error('❌ record エラー:', error);
    const msg = `❌ エラーが発生しました: ${error instanceof Error ? error.message : error}`;
    if (interaction.deferred) {
      await interaction.editReply(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}

async function handleStatus(interaction: ChatInputCommandInteraction, handler: VoiceHandler): Promise<void> {
  try {
    const guildId = interaction.guild!.id;

    if (voiceConnections.has(guildId) && handler.recording) {
      const duration = (Date.now() - handler.sessionStartTime!.getTime()) / 1000;
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      await interaction.reply(`🎙️ 記録中\n記録時間: ${minutes}分 ${seconds}秒`);
    } else {
      await interaction.reply('⏹️ 記録停止中');
    }
  } catch (error) {
    console.error('❌ status エラー:', error);
    await interaction.reply(`❌ エラーが発生しました: ${error instanceof Error ? error.message : error}`);
  }
}

async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const helpText = `
📖 Discord 議事録ボット コマンド一覧

\`/join\` - ボイスチャネルに接続（記録開始）
\`/leave\` - ボイスチャネルから切断（記録停止）
\`/record start\` - 記録を開始
\`/record stop\` - 記録を停止
\`/status\` - 現在の記録状態を表示
\`/help\` - このメッセージを表示

📝 使用方法：
1. ボイスチャネルに参加
2. \`/join\` で接続
3. 会議・ミーティングを実施
4. \`/leave\` で終了 → 議事録が自動保存
  `;

  await interaction.reply(helpText);
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN が .env に設定されていません');
  process.exit(1);
}

client.login(token);
