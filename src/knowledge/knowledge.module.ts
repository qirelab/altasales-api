import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
import { KnowledgeIndexJob } from './entities/knowledge-index-job.entity';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeChunkingService } from './services/knowledge-chunking.service';
import { KnowledgeDocumentsService } from './services/knowledge-documents.service';
import { KnowledgeExtractionService } from './services/knowledge-extraction.service';
import { KnowledgeHtmlExtractionService } from './services/knowledge-html-extraction.service';
import { KnowledgeIngestionService } from './services/knowledge-ingestion.service';
import { KnowledgeOcrService } from './services/knowledge-ocr.service';
import { KnowledgePdfPageRendererService } from './services/knowledge-pdf-page-renderer.service';
import { KnowledgeSearchService } from './services/knowledge-search.service';
import { KnowledgeTesseractCliOcrProvider } from './services/knowledge-tesseract-cli-ocr-provider.service';
import { KnowledgeUrlSourceService } from './services/knowledge-url-source.service';
import { KNOWLEDGE_VECTOR_STORE } from './vector-store/knowledge-vector-store.interface';
import { QdrantKnowledgeVectorStore } from './vector-store/qdrant-knowledge-vector-store.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeDocument,
      KnowledgeChunk,
      KnowledgeIndexJob,
    ]),
    AuthModule,
    AiModule,
  ],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeDocumentsService,
    KnowledgeExtractionService,
    KnowledgeHtmlExtractionService,
    KnowledgeOcrService,
    KnowledgePdfPageRendererService,
    KnowledgeTesseractCliOcrProvider,
    KnowledgeChunkingService,
    KnowledgeIngestionService,
    KnowledgeSearchService,
    KnowledgeUrlSourceService,
    QdrantKnowledgeVectorStore,
    {
      provide: KNOWLEDGE_VECTOR_STORE,
      useExisting: QdrantKnowledgeVectorStore,
    },
  ],
  exports: [KnowledgeSearchService, KnowledgeDocumentsService],
})
export class KnowledgeModule {}
