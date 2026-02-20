import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

export class WhisperClient {
  private apiKey: string;
  private endpoint: string;
  private model: string;

  constructor() {
    const apiKey = process.env.SAKURA_API_KEY;
    if (!apiKey) {
      throw new Error('SAKURA_API_KEY が .env に設定されていません');
    }
    this.apiKey = apiKey;
    this.endpoint = 'https://api.ai.sakura.ad.jp/v1/audio/transcriptions';
    this.model = 'whisper-large-v3-turbo';
  }

  async transcribe(audioFilePath: string, language = 'ja'): Promise<string> {
    try {
      if (!fs.existsSync(audioFilePath)) {
        throw new Error(`音声ファイルが見つかりません: ${audioFilePath}`);
      }

      const fileStream = fs.createReadStream(audioFilePath);
      const fileName = path.basename(audioFilePath);

      const formData = new FormData();
      formData.append('file', fileStream, fileName);
      formData.append('model', this.model);
      formData.append('language', language);

      console.log(`🔄 Whisper 認識中: ${fileName}`);

      const response = await axios.post(this.endpoint, formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders()
        },
        timeout: 30000
      });

      const text: string = response.data.text || '';
      console.log(`✅ Whisper 認識成功: ${text.length} 文字`);
      return text;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`❌ Whisper エラー:`, error.message);
        if (error.response) {
          console.error(`   ステータス: ${error.response.status}`);
          console.error(`   レスポンス: ${JSON.stringify(error.response.data)}`);
        }
      } else if (error instanceof Error) {
        console.error(`❌ Whisper エラー:`, error.message);
      }
      return '';
    }
  }

  async transcribeFromBuffer(audioData: Buffer, fileName = 'audio.wav'): Promise<string> {
    try {
      const formData = new FormData();

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

      const text: string = response.data.text || '';
      console.log(`✅ Whisper 認識成功: ${text.length} 文字`);
      return text;
    } catch (error) {
      console.error(`❌ Whisper エラー:`, error instanceof Error ? error.message : error);
      return '';
    }
  }
}
