import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

export class WhisperClient {
  constructor() {
    this.apiKey = process.env.SAKURA_API_KEY;
    this.endpoint = 'https://api.ai.sakura.ad.jp/v1/audio/transcriptions';
    this.model = 'whisper-large-v3-turbo';

    if (!this.apiKey) {
      throw new Error('SAKURA_API_KEY が .env に設定されていません');
    }
  }

  /**
   * 音声ファイルをテキストに変換
   * @param {string} audioFilePath - 音声ファイルのパス
   * @param {string} language - 言語コード（デフォルト: ja）
   * @returns {Promise<string>} 認識されたテキスト
   */
  async transcribe(audioFilePath, language = 'ja') {
    try {
      // ファイルの存在確認
      if (!fs.existsSync(audioFilePath)) {
        throw new Error(`音声ファイルが見つかりません: ${audioFilePath}`);
      }

      const fileStream = fs.createReadStream(audioFilePath);
      const fileName = path.basename(audioFilePath);

      // FormData を作成（axios で自動処理）
      const formData = new FormData();
      formData.append('file', fileStream, fileName);
      formData.append('model', this.model);
      formData.append('language', language);

      console.log(`🔄 Whisper 認識中: ${fileName}`);

      const response = await axios.post(this.endpoint, formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders() // form-data パッケージの getHeaders() メソッド
        },
        timeout: 30000
      });

      const text = response.data.text || '';
      console.log(`✅ Whisper 認識成功: ${text.length} 文字`);
      return text;
    } catch (error) {
      console.error(`❌ Whisper エラー:`, error.message);
      if (error.response) {
        console.error(`   ステータス: ${error.response.status}`);
        console.error(`   レスポンス: ${JSON.stringify(error.response.data)}`);
      }
      return '';
    }
  }

  /**
   * バイナリ音声データを直接認識
   * @param {Buffer} audioData - 音声データ（バイナリ）
   * @param {string} fileName - ファイル名（拡張子で形式判定）
   * @returns {Promise<string>} 認識されたテキスト
   */
  async transcribeFromBuffer(audioData, fileName = 'audio.wav') {
    try {
      const formData = new FormData();

      // Buffer を直接 FormData に追加
      formData.append('file', audioData, {
        filename: fileName,
        contentType: 'audio/wav'
      });
      formData.append('model', this.model);
      formData.append('language', 'ja');

      console.log(`🔄 Whisper 認識中: ${fileName}`);

      const response = await axios.post(this.endpoint, formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders()
        },
        timeout: 30000
      });

      const text = response.data.text || '';
      console.log(`✅ Whisper 認識成功: ${text.length} 文字`);
      return text;
    } catch (error) {
      console.error(`❌ Whisper エラー:`, error.message);
      return '';
    }
  }
}
