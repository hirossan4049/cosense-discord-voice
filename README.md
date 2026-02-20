# Discord 議事録ボット（Node.js 版）

Discord ボイスチャットの音声を Whisper で自動認識して、Scrapbox に議事録として保存するボット。

## 機能

- ✅ **人ごとに音声分離** - @discordjs/voice で各ユーザーの音声を個別に記録
- ✅ `!join` - ボイスチャネルに参加（記録開始）
- ✅ `!leave` - ボイスチャネルから退出（記録停止・議事録作成完了）
- ✅ `!record start` / `!record stop` - 記録の開始・停止
- ✅ `!status` - 現在の記録状態表示
- ✅ **Whisper 自動認識** - さくらのAI で各ユーザーの音声をテキスト化
- ✅ **Scrapbox 自動保存** - タイムスタンプ + ユーザー名付きで議事録を記録

## 環境構築

### 1. 依存パッケージのインストール

```bash
cd /home/openclaw/.openclaw/workspace/discord-bot
npm install
```

### 2. 環境変数設定（既に完了）

`.env` に以下が設定されていることを確認：
```
DISCORD_TOKEN=your_token_here
SAKURA_API_KEY=your_key_here
COSENSE_PROJECT_NAME=localhouse
COSENSE_SID=your_sid_here
```

### 3. システム依存パッケージ

FFmpeg がインストールされていることを確認：
```bash
ffmpeg -version
```

未インストールの場合：
```bash
sudo apt-get install ffmpeg
```

### 4. Cosense MCP サーバーの起動（前提）

cosense-mcp-server がビルドされていることを確認：
```bash
ls -la /tmp/cosense-mcp-server/build/index.js
```

未ビルドの場合：
```bash
cd /tmp/cosense-mcp-server
pnpm install
pnpm run build
```

## 起動方法

```bash
cd /home/openclaw/.openclaw/workspace/discord-bot
npm start
```

コンソールに以下が表示されたら成功：
```
✅ ボット起動: BotName#0000
   接続中のギルド数: 1
```

## 使用方法

### 基本フロー

1. **ボイスチャネルに接続**
   - Discord のボイスチャネルに参加してから、`!join` を実行

2. **記録開始の確認**
   - ボットが ✅ と 🎙️ メッセージで応答

3. **会議・ミーティング実施**
   - ボイスチャネルで普通に会話

4. **記録停止**
   - `!leave` または `!record stop` を実行
   - ボットが音声を認識して Scrapbox に保存

5. **Scrapbox で確認**
   - ボットが送信したリンクをクリック

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `!join` | ボイスチャネルに接続（記録開始） |
| `!leave` | ボイスチャネルから退出（記録停止） |
| `!record start` | 記録を開始 |
| `!record stop` | 記録を停止 |
| `!status` | 現在の記録状態を表示 |
| `!help` | コマンド一覧を表示 |

## ファイル構成

```
discord-bot/
├── bot.js                  # メインボット（コマンド処理）
├── voiceHandler.js         # ボイスチャネル接続・音声キャプチャ
├── whisperClient.js        # さくらのAI Whisper API クライアント
├── scrapboxWriter.js       # Scrapbox MCP への書き込み
├── package.json            # 依存パッケージ定義
├── .env                    # 環境変数（API Key など）
├── .gitignore             # Git 除外設定
└── README.md              # このファイル
```

## API 連携

### さくらのAI Whisper API

- **エンドポイント:** `https://api.ai.sakura.ad.jp/v1/audio/transcriptions`
- **モデル:** `whisper-large-v3-turbo`
- **認証:** Bearer Token（.env に記載）

### Discord.js + @discordjs/voice

- **ライブラリ:** discord.js v14
- **音声操作:** @discordjs/voice（ユーザーごと音声分離）
- **ストリーム処理:** FFmpeg（PCM → WAV 変換）

### Scrapbox MCP

- **プロジェクト:** `localhouse`
- **操作:** cosense-mcp-server を経由して `insert_lines`
- **環境変数:** .env から参照

## トラブルシューティング

### ボットが起動しない

```bash
# 依存パッケージ再インストール
npm install

# Node.js バージョン確認（v18+ 推奨）
node --version
```

### Whisper 認識が失敗する

```bash
# .env を確認
cat .env | grep SAKURA

# インターネット接続確認
curl https://api.ai.sakura.ad.jp/v1/audio/transcriptions
```

### Scrapbox に保存されない

```bash
# cosense-mcp-server がビルドされているか確認
file /tmp/cosense-mcp-server/build/index.js

# 環境変数確認
grep COSENSE .env
```

### FFmpeg エラー

```bash
# FFmpeg がインストールされているか確認
which ffmpeg
ffmpeg -version

# インストール（Linux）
sudo apt-get install ffmpeg
```

## 実装詳細

### @discordjs/voice による音声分離

`voiceHandler.js` の `VoiceHandler` クラスが @discordjs/voice を使用して、各ユーザーの音声を個別に処理します。

```javascript
// 各ユーザーの音声をリッスン
connection.receiver.speaking.on('start', (userId) => {
  // ユーザーが話し始めた
  // connection.receiver.createStream(userId) で音声ストリームを取得
  // FFmpeg で PCM → WAV に変換
});
```

**仕組み:**
1. `connection.receiver` で各ユーザーの音声ストリームを取得
2. FFmpeg で PCM フォーマットを WAV に変換
3. 各ユーザーのファイルを個別に Whisper で認識
4. タイムスタンプ＋ユーザー名で Scrapbox に記録

## 今後の改善案

- [ ] 音声ファイルの自動クリーンアップ
- [ ] Scrapbox での自動見出し生成（時間帯ごと）
- [ ] 外部への Webhook 連携（メール通知など）
- [ ] Voice Activity Detection（VAD）による無音検出
- [ ] 複数ギルドの同時記録

---

**作成日:** 2026-02-19
**言語:** JavaScript (Node.js)
**ランタイム:** Node.js 18+
**ライセンス:** MIT
