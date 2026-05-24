import { DataClass } from '../../ai/enums/data-class.enum';
import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';
import { KnowledgeSearchService } from './knowledge-search.service';

describe('KnowledgeSearchService', () => {
  it('embeds query through proxy, filters by purpose, and never returns vectors', async () => {
    const embeddingProxy = {
      embed: jest.fn().mockResolvedValue({ vectors: [[0.1, 0.2]] }),
    };
    const vectorStore = {
      search: jest.fn().mockResolvedValue([
        { chunkId: 'chunk-2', score: 0.9 },
        { chunkId: 'chunk-1', score: 0.8 },
      ]),
    };
    const chunkRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'chunk-1',
          text: 'First result',
          chunkIndex: 0,
          metadata: {},
          document: { id: 'doc-1', title: 'Guide', purpose: 'recommendations' },
        },
        {
          id: 'chunk-2',
          text: 'Second result',
          chunkIndex: 1,
          metadata: {},
          document: { id: 'doc-1', title: 'Guide', purpose: 'recommendations' },
        },
      ]),
    };
    const service = new KnowledgeSearchService(
      embeddingProxy as never,
      vectorStore as never,
      chunkRepository as never,
    );

    const result = await service.search({
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      query: 'private customer question',
      limit: 2,
    });

    expect(embeddingProxy.embed).toHaveBeenCalledWith({
      inputs: ['private customer question'],
      declaredDataClass: DataClass.RawPii,
    });
    expect(vectorStore.search).toHaveBeenCalledWith(
      [0.1, 0.2],
      { purpose: KnowledgeBasePurpose.RECOMMENDATIONS },
      2,
    );
    expect(result.results.map((entry) => entry.chunkId)).toEqual([
      'chunk-2',
      'chunk-1',
    ]);
    expect(JSON.stringify(result)).not.toContain('0.1');
    expect(JSON.stringify(result)).not.toContain('0.2');
  });
});
