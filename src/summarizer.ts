import axios from 'axios';

export class Summarizer {
  private apiKey: string;
  private endpoint: string;
  private model: string;

  constructor() {
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      throw new Error('LLM_API_KEY が .env に設定されていません');
    }
    this.apiKey = apiKey;

    const endpoint = process.env.LLM_API_ENDPOINT;
    if (!endpoint) {
      throw new Error('LLM_API_ENDPOINT が .env に設定されていません');
    }
    this.endpoint = endpoint;

    const model = process.env.LLM_MODEL;
    if (!model) {
      throw new Error('LLM_MODEL が .env に設定されていません');
    }
    this.model = model;
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
              content: `会議の議事録を要約してください。重要なポイント、決定事項、アクションアイテムを簡潔にまとめてください。
出力はScrapbox記法で書いてください。Markdownは使わないでください。
Scrapbox記法のルール:
- 太字: [[テキスト]]
- 見出し(大): [** テキスト]、見出し(小): [* テキスト]
- 箇条書き: 行頭にスペースを入れる（ネストはスペース追加）
- リンク: [ページ名]
- Markdownの**太字**や- リストや# 見出しは使わないこと`,
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
