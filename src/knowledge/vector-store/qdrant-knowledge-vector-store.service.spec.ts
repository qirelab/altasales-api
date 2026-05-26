import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { QdrantKnowledgeVectorStore } from './qdrant-knowledge-vector-store.service';

describe('QdrantKnowledgeVectorStore', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      QDRANT_COLLECTION_NAME: process.env.QDRANT_COLLECTION_NAME,
      QDRANT_VECTOR_SIZE: process.env.QDRANT_VECTOR_SIZE,
      QDRANT_DISTANCE: process.env.QDRANT_DISTANCE,
    };
    process.env.QDRANT_COLLECTION_NAME = 'knowledge_test';
    process.env.QDRANT_VECTOR_SIZE = '2';
    process.env.QDRANT_DISTANCE = 'Cosine';
  });

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  it('accepts an existing collection with matching vector config', async () => {
    const client = qdrantClient({
      collectionExists: jest.fn().mockResolvedValue({ exists: true }),
      getCollection: jest.fn().mockResolvedValue(collectionInfo(2, 'Cosine')),
      createCollection: jest.fn(),
    });
    const store = vectorStoreWithClient(client);

    await expect(store.ensureCollection()).resolves.toBeUndefined();

    expect(client.getCollection).toHaveBeenCalledWith('knowledge_test');
    expect(client.createCollection).not.toHaveBeenCalled();
  });

  it('fails safely when an existing collection has mismatched vector config', async () => {
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const client = qdrantClient({
      collectionExists: jest.fn().mockResolvedValue({ exists: true }),
      getCollection: jest.fn().mockResolvedValue(collectionInfo(1536, 'Dot')),
      createCollection: jest.fn(),
    });
    const store = vectorStoreWithClient(client);

    await expect(store.ensureCollection()).rejects.toThrow(
      new ServiceUnavailableException(
        'Knowledge vector store configuration mismatch',
      ),
    );

    const serializedLogs = loggerErrorSpy.mock.calls
      .flat()
      .map((entry) => JSON.stringify(entry))
      .join(' ');
    expect(serializedLogs).toContain('knowledge_test');
    expect(serializedLogs).toContain('1536');
    expect(serializedLogs).toContain('Dot');
    expect(serializedLogs).not.toContain('secret');
    expect(serializedLogs).not.toContain('payload text');
    expect(client.createCollection).not.toHaveBeenCalled();
  });

  it('creates the collection when it is absent', async () => {
    const client = qdrantClient({
      collectionExists: jest.fn().mockResolvedValue({ exists: false }),
      getCollection: jest.fn(),
      createCollection: jest.fn().mockResolvedValue(undefined),
    });
    const store = vectorStoreWithClient(client);

    await expect(store.ensureCollection()).resolves.toBeUndefined();

    expect(client.getCollection).not.toHaveBeenCalled();
    expect(client.createCollection).toHaveBeenCalledWith('knowledge_test', {
      vectors: {
        size: 2,
        distance: 'Cosine',
      },
    });
  });
});

type MockQdrantClient = {
  collectionExists: jest.Mock;
  getCollection: jest.Mock;
  createCollection: jest.Mock;
};

function qdrantClient(client: MockQdrantClient): MockQdrantClient {
  return client;
}

function vectorStoreWithClient(
  client: MockQdrantClient,
): QdrantKnowledgeVectorStore {
  return new QdrantKnowledgeVectorStore(client as never);
}

function collectionInfo(size: number, distance: string): Record<string, unknown> {
  return {
    config: {
      params: {
        vectors: {
          size,
          distance,
        },
      },
    },
  };
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
