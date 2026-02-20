import { patch } from '@cosense/std/websocket';

export class ScrapboxWriter {
  private cosenseSid: string | undefined;
  private cosenseProjectName: string;

  constructor() {
    this.cosenseSid = process.env.COSENSE_SID;
    this.cosenseProjectName = process.env.COSENSE_PROJECT_NAME || 'localhouse';
  }

  async appendToPage(pageTitle: string, content: string): Promise<boolean> {
    try {
      const result = await patch(
        this.cosenseProjectName,
        pageTitle,
        (lines) => {
          const linesText = lines.map((line) => line.text);
          return [...linesText, ...content.split('\n')];
        },
        { sid: this.cosenseSid }
      );

      if (result.ok) {
        console.log(`✅ Scrapbox に書き込み成功: ${pageTitle}`);
        return true;
      } else {
        console.error(`❌ Scrapbox 書き込み失敗:`, result.val);
        return false;
      }
    } catch (error) {
      console.error(`❌ Scrapbox 書き込みエラー:`, error instanceof Error ? error.message : error);
      return false;
    }
  }

  createMinutesPage(date = new Date()): string {
    const dateStr = date.toISOString().split('T')[0];
    return `議事録 ${dateStr}`;
  }

  formatMinutesEntry(userName: string, text: string, timestamp = new Date()): string {
    const timeStr = timestamp.toLocaleTimeString('ja-JP', { hour12: false });
    return `[${timeStr}] **${userName}**: ${text}`;
  }

  getPageUrl(pageTitle: string): string {
    return `https://scrapbox.io/${this.cosenseProjectName}/${encodeURIComponent(pageTitle)}`;
  }
}
