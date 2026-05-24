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
import { KnowledgeIngestionService } from './services/knowledge-ingestion.service';
import { KnowledgeSearchService } from './services/knowledge-search.service';
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
    KnowledgeChunkingService,
    KnowledgeIngestionService,
    KnowledgeSearchService,
    QdrantKnowledgeVectorStore,
    {
      provide: KNOWLEDGE_VECTOR_STORE,
      useExisting: QdrantKnowledgeVectorStore,
    },
  ],
  exports: [KnowledgeSearchService, KnowledgeDocumentsService],
})
export class KnowledgeModule {}
