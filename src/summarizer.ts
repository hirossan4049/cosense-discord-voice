import axios from 'axios';

export class Summarizer {
  private apiKey: string;
  private endpoint = 'https://api.ai.sakura.ad.jp/v1/chat/completions';
  private model = 'gpt-oss-120b';

  constructor() {
    const apiKey = process.env.SAKURA_API_KEY;
    if (!apiKey) {
      throw new Error('SAKURA_API_KEY が .env に設定されていません');
    }
    this.apiKey = apiKey;
  }

  async summarize(transcript: string): Promise<string> {
    try {
      console.log('📝 議事録を要約中...');

      const response = await axios.post(
        this.endpoint,
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: '会議の議事録を要約してください。重要なポイント、決定事項、アクションアイテムを簡潔にまとめてください。',
            },
            {
              role: 'user',
              content: transcript,
            },
          ],
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      const summary = response.data.choices?.[0]?.message?.content || '';
      console.log(`✅ 要約完了: ${summary.length} 文字`);
      return summary;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('❌ 要約エラー:', error.message);
        if (error.response) {
          console.error(`   ステータス: ${error.response.status}`);
          console.error(`   レスポンス: ${JSON.stringify(error.response.data)}`);
        }
      } else if (error instanceof Error) {
        console.error('❌ 要約エラー:', error.message);
      }
      return '';
    }
  }
}
