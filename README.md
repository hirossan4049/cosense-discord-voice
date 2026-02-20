# giziroku

Discord のボイスチャットを自動で文字起こしし、[Scrapbox](https://scrapbox.io) に議事録として保存する Bot。

## Features

- ボイスチャネルの音声をユーザーごとに分離・録音
- Whisper による自動文字起こし
- LLM による議事録の要約生成
- Scrapbox へのリアルタイム書き込み（タイムスタンプ + 話者名付き）

## Requirements

- Node.js 18+
- FFmpeg
- pnpm

## Setup

```bash
git clone https://github.com/yourname/giziroku-discord-bot.git
cd giziroku-discord-bot
pnpm install
cp .env.example .env
```

`.env` を編集して必要な値を設定:

```
DISCORD_TOKEN=
STT_API_KEY=
LLM_API_KEY=
COSENSE_SID=
COSENSE_PROJECT_NAME=
```

詳細は [.env.example](.env.example) を参照。

## Usage

```bash
# development
pnpm dev

# production
pnpm build && pnpm start
```

### Commands

| Command | Description |
|---|---|
| `/join` | ボイスチャネルに参加して録音開始 |
| `/leave` | 録音を停止し、要約を生成して退出 |
| `/record start` / `stop` | 録音の開始・停止 |
| `/status` | 現在の録音状態を表示 |
| `/help` | コマンド一覧を表示 |

## Architecture

```
src/
├── bot.ts              # エントリーポイント / スラッシュコマンド
├── voiceHandler.ts     # 音声キャプチャ・ストリーム処理
├── whisperClient.ts    # Speech-to-Text API クライアント
├── scrapboxWriter.ts   # Scrapbox 書き込み
└── summarizer.ts       # LLM 要約生成
```

## License

MIT
