import { patch } from './cosense-mcp-server/node_modules/.pnpm/@jsr+cosense__std@0.30.2/node_modules/@jsr/cosense__std/websocket/patch.js';

export class ScrapboxWriter {
  constructor() {
    this.projectName = 'localhouse';
    // 環境変数から COSENSE 設定を取得
    this.cosenseSid = process.env.COSENSE_SID;
    this.cosenseProjectName = process.env.COSENSE_PROJECT_NAME || 'localhouse';
  }

  /**
   * Scrapbox ページに内容を追記する（直接 API 呼び出し）
   * @param {string} pageTitle - ページタイトル
   * @param {string} content - 追記するテキスト
   * @returns {Promise<boolean>} 成功時 true
   */
  async appendToPage(pageTitle, content) {
    try {
      const result = await patch(
        this.cosenseProjectName,
        pageTitle,
        (lines) => {
          // ページ末尾に追記
          const linesText = lines.map((line) => line.text);
          return [...linesText, ...content.split('\n')];
        },
        { sid: this.cosenseSid }
      );

      if (result.ok) {
        console.log(`✅ Scrapbox に書き込み成功: ${pageTitle}`);
        return true;
      } else {
        console.error(`❌ Scrapbox 書き込み失敗:`, result.value);
        return false;
      }
    } catch (error) {
      console.error(`❌ Scrapbox 書き込みエラー:`, error.message);
      return false;
    }
  }

  /**
   * 議事録ページを作成（日付ごと）
   * @param {Date} date - 日付（Noneなら今日）
   * @returns {string} 作成したページタイトル
   */
  createMinutesPage(date = new Date()) {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD 形式
    return `議事録 ${dateStr}`;
  }

  /**
   * 議事録のエントリをフォーマット
   * @param {string} userName - 発言者名
   * @param {string} text - 発言内容
   * @param {Date} timestamp - タイムスタンプ
   * @returns {string} フォーマット済みテキスト
   */
  formatMinutesEntry(userName, text, timestamp = new Date()) {
    const timeStr = timestamp.toLocaleTimeString('ja-JP', { hour12: false });
    return `[${timeStr}] **${userName}**: ${text}`;
  }

  /**
   * ページのURLを取得
   * @param {string} pageTitle - ページタイトル
   * @returns {string} ページのURL
   */
  getPageUrl(pageTitle) {
    // Cosense の正しい URL 形式
    return `https://scrapbox.io/${this.cosenseProjectName}/${encodeURIComponent(pageTitle)}`;
  }
}
