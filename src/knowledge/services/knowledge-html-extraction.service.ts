import { BadRequestException, Injectable } from '@nestjs/common';
import { KnowledgeExtractionResult } from './knowledge-extraction.service';

const MIN_EXTRACTED_TEXT_LENGTH = 20;

@Injectable()
export class KnowledgeHtmlExtractionService {
  extract(html: string): KnowledgeExtractionResult & { title?: string } {
    const title = this.extractTitle(html);
    const text = this.normalizeWhitespace(
      this.decodeHtmlEntities(
        this.stripTags(this.extractBody(this.removeNoisyMarkup(html))),
      ),
    );

    if (text.length < MIN_EXTRACTED_TEXT_LENGTH) {
      throw new BadRequestException('Knowledge URL text is empty');
    }

    return {
      title,
      blocks: [{
        text,
        metadata: {
          sourceFormat: 'html',
        },
      }],
    };
  }

  private extractTitle(html: string): string | undefined {
    const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = match
      ? this.normalizeWhitespace(
        this.decodeHtmlEntities(this.stripTags(match[1])),
      )
      : '';

    return title || undefined;
  }

  private extractBody(html: string): string {
    const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      return mainMatch[1];
    }

    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch ? bodyMatch[1] : html;
  }

  private removeNoisyMarkup(html: string): string {
    return html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|canvas|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  }

  private stripTags(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_match, code: string) =>
        String.fromCodePoint(Number(code)),
      )
      .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
        String.fromCodePoint(Number.parseInt(code, 16)),
      );
  }

  private normalizeWhitespace(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
