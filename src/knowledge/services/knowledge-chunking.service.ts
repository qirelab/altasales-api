import { BadRequestException, Injectable } from '@nestjs/common';
import { KnowledgeExtractedTextBlock } from './knowledge-extraction.service';

export type KnowledgePreparedChunk = {
  chunkIndex: number;
  text: string;
  charLength: number;
  tokenEstimate: number;
  metadata: Record<string, unknown>;
};

const DEFAULT_CHUNK_SIZE_CHARS = 4_000;
const DEFAULT_CHUNK_OVERLAP_CHARS = 500;
const DEFAULT_MAX_CHUNKS_PER_DOCUMENT = 1_000;

@Injectable()
export class KnowledgeChunkingService {
  chunk(blocks: KnowledgeExtractedTextBlock[]): KnowledgePreparedChunk[] {
    const chunkSize = this.getPositiveInteger(
      process.env.KNOWLEDGE_CHUNK_SIZE_CHARS,
      DEFAULT_CHUNK_SIZE_CHARS,
    );
    const overlap = Math.min(
      this.getPositiveInteger(
        process.env.KNOWLEDGE_CHUNK_OVERLAP_CHARS,
        DEFAULT_CHUNK_OVERLAP_CHARS,
      ),
      Math.max(0, chunkSize - 1),
    );
    const maxChunks = this.getPositiveInteger(
      process.env.KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT,
      DEFAULT_MAX_CHUNKS_PER_DOCUMENT,
    );

    const chunks: KnowledgePreparedChunk[] = [];

    for (const block of blocks) {
      for (const text of this.splitBlock(block.text, chunkSize, overlap)) {
        chunks.push({
          chunkIndex: chunks.length,
          text,
          charLength: text.length,
          tokenEstimate: this.estimateTokens(text),
          metadata: block.metadata ?? {},
        });

        if (chunks.length > maxChunks) {
          throw new BadRequestException('Knowledge document has too many chunks');
        }
      }
    }

    if (!chunks.length) {
      throw new BadRequestException('Knowledge document text is empty');
    }

    return chunks;
  }

  private splitBlock(
    text: string,
    chunkSize: number,
    overlap: number,
  ): string[] {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    for (const paragraph of paragraphs) {
      if (paragraph.length > chunkSize) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        chunks.push(...this.splitLongText(paragraph, chunkSize, overlap));
        continue;
      }

      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
      if (candidate.length <= chunkSize) {
        current = candidate;
      } else {
        if (current) {
          chunks.push(current);
        }
        current = paragraph;
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks.flatMap((chunk) =>
      chunk.length > chunkSize
        ? this.splitLongText(chunk, chunkSize, overlap)
        : [chunk],
    );
  }

  private splitLongText(
    text: string,
    chunkSize: number,
    overlap: number,
  ): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(text.length, start + chunkSize);
      chunks.push(text.slice(start, end).trim());
      if (end >= text.length) {
        break;
      }
      start = Math.max(end - overlap, start + 1);
    }

    return chunks.filter(Boolean);
  }

  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private getPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
