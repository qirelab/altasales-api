export enum KnowledgeIndexStage {
  PENDING = 'pending',
  EXTRACTING = 'extracting',
  CHUNKING = 'chunking',
  EMBEDDING = 'embedding',
  INDEXING = 'indexing',
  INDEXED = 'indexed',
  FAILED = 'failed',
}
