import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReferenceAnswerSortBy, SortDir } from '../dto/list-reference-answers.dto';
import { ReferenceAnswerStatus } from '../enums/reference-answer-status.enum';
import { ChatbotReferenceAnswersService } from './chatbot-reference-answers.service';

function buildRepositoryMock() {
  const store = new Map<string, Record<string, unknown>>();
  const qb: Record<string, jest.Mock> = {};
  const orderCalls: unknown[] = [];
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn((...args) => {
    orderCalls.push(args);
    return qb;
  });
  qb.skip = jest.fn().mockReturnValue(qb);
  qb.take = jest.fn().mockReturnValue(qb);
  qb.getManyAndCount = jest.fn().mockResolvedValue([Array.from(store.values()), store.size]);

  return {
    store,
    orderCalls,
    createQueryBuilder: jest.fn(() => qb),
    create: jest.fn((entity) => ({ ...entity, id: `id-${store.size + 1}` })),
    save: jest.fn(async (entity) => {
      const id = entity.id ?? `id-${store.size + 1}`;
      const saved = { ...entity, id };
      store.set(id, saved);
      return saved;
    }),
    findOne: jest.fn(async ({ where }) => store.get(where.id) ?? null),
    qb,
  };
}

function buildScannerMock(hasPii = false) {
  return {
    scanText: jest.fn().mockReturnValue({
      hasPii,
      stats: hasPii ? { email: 1 } : { email: 0 },
    }),
  };
}

function buildDocumentRepoMock(exists = true) {
  return {
    exists: jest.fn().mockResolvedValue(exists),
  };
}

function buildIndexerMock() {
  return {
    safeIndex: jest.fn().mockResolvedValue(undefined),
    safeRemove: jest.fn().mockResolvedValue(undefined),
  };
}

function buildService(hasPii = false, documentExists = true) {
  const repository = buildRepositoryMock();
  const documentRepository = buildDocumentRepoMock(documentExists);
  const scanner = buildScannerMock(hasPii);
  const indexer = buildIndexerMock();
  const service = new ChatbotReferenceAnswersService(
    repository as never,
    documentRepository as never,
    scanner as never,
    indexer as never,
  );
  return { service, repository, documentRepository, scanner, indexer };
}

const validDto = () => ({
  question: 'Сколько стоит CRM Silver?',
  answer: 'Пакет CRM Silver стоит 100 000 рублей и включает внедрение.',
  topic: 'Цены',
});

describe('ChatbotReferenceAnswersService', () => {
  it('creates a reference answer when payload has no PII', async () => {
    const { service, repository, scanner } = buildService();

    const result = await service.create({ ...validDto() }, 'user-1');

    expect(scanner.scanText).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Сколько стоит CRM Silver?',
        topic: 'Цены',
        createdById: 'user-1',
        status: ReferenceAnswerStatus.ACTIVE,
      }),
    );
    expect(result.id).toBeDefined();
  });

  it('rejects create with BadRequestException when PII detected', async () => {
    const { service } = buildService(true);
    await expect(service.create(validDto(), 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('links sourceDocumentId when provided and document exists', async () => {
    const { service, repository, documentRepository } = buildService();
    await service.create({ ...validDto(), sourceDocumentId: 'doc-9' }, 'user-1');
    expect(documentRepository.exists).toHaveBeenCalledWith({ where: { id: 'doc-9' } });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDocumentId: 'doc-9' }),
    );
  });

  it('rejects create with NotFoundException when sourceDocumentId does not exist', async () => {
    const { service } = buildService(false, false);
    await expect(
      service.create({ ...validDto(), sourceDocumentId: 'missing-doc' }, 'user-1'),
    ).rejects.toThrow('Документ-источник не найден');
  });

  it('does not query documentRepository when sourceDocumentId is not provided', async () => {
    const { service, documentRepository } = buildService();
    await service.create(validDto(), 'user-1');
    expect(documentRepository.exists).not.toHaveBeenCalled();
  });

  it('accepts null createdById (system-created)', async () => {
    const { service, repository } = buildService();
    await service.create(validDto(), null);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: null }),
    );
  });

  it('finds one or throws NotFoundException', async () => {
    const { service, repository } = buildService();
    repository.store.set('id-1', { id: 'id-1', topic: 'X' });

    const found = await service.findOne('id-1');
    expect(found.id).toBe('id-1');

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    await expect(service.findOne('missing')).rejects.toThrow('Эталонный ответ не найден');
  });

  it('updates fields and re-scans PII only when text fields change', async () => {
    const { service, repository, scanner } = buildService();
    repository.store.set('id-1', {
      id: 'id-1',
      question: 'q',
      answer: 'a',
      topic: 't',
      status: ReferenceAnswerStatus.ACTIVE,
    });

    await service.update('id-1', { topic: 'Цены' });
    expect(scanner.scanText).toHaveBeenCalledTimes(1);

    scanner.scanText.mockClear();
    await service.update('id-1', { sourceDocumentId: 'doc-1' });
    expect(scanner.scanText).not.toHaveBeenCalled();
  });

  it('rejects update when new sourceDocumentId does not exist', async () => {
    const { service, repository } = buildService(false, false);
    repository.store.set('id-1', {
      id: 'id-1',
      question: 'q',
      answer: 'a',
      topic: 't',
      status: ReferenceAnswerStatus.ACTIVE,
    });
    await expect(
      service.update('id-1', { sourceDocumentId: 'missing-doc' }),
    ).rejects.toThrow('Документ-источник не найден');
  });

  it('rejects update when new payload contains PII', async () => {
    const { service, repository, scanner } = buildService();
    repository.store.set('id-1', {
      id: 'id-1',
      question: 'q',
      answer: 'a',
      topic: 't',
      status: ReferenceAnswerStatus.ACTIVE,
    });
    scanner.scanText.mockReturnValueOnce({ hasPii: true, stats: { email: 1 } });

    await expect(service.update('id-1', { answer: 'my email a@b.ru' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('calls indexer.safeIndex on create', async () => {
    const { service, indexer } = buildService();
    const result = await service.create(validDto(), 'user-1');
    expect(indexer.safeIndex).toHaveBeenCalledWith(
      expect.objectContaining({ id: result.id, status: ReferenceAnswerStatus.ACTIVE }),
    );
  });

  it('calls indexer.safeIndex on update of active record', async () => {
    const { service, repository, indexer } = buildService();
    repository.store.set('id-1', {
      id: 'id-1',
      question: 'q',
      answer: 'a',
      topic: 't',
      status: ReferenceAnswerStatus.ACTIVE,
    });
    await service.update('id-1', { topic: 'Цены' });
    expect(indexer.safeIndex).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'id-1', topic: 'Цены' }),
    );
  });

  it('skips indexer.safeIndex on update of archived record', async () => {
    const { service, repository, indexer } = buildService();
    repository.store.set('id-1', {
      id: 'id-1',
      question: 'q',
      answer: 'a',
      topic: 't',
      status: ReferenceAnswerStatus.ARCHIVED,
    });
    await service.update('id-1', { topic: 'Цены' });
    expect(indexer.safeIndex).not.toHaveBeenCalled();
  });

  it('does not call indexer when archive/restore is a no-op (status unchanged)', async () => {
    const { service, repository, indexer } = buildService();
    repository.store.set('id-1', {
      id: 'id-1',
      question: 'q',
      answer: 'a',
      topic: 't',
      status: ReferenceAnswerStatus.ARCHIVED,
    });

    await service.archive('id-1');
    expect(indexer.safeRemove).not.toHaveBeenCalled();
    expect(indexer.safeIndex).not.toHaveBeenCalled();
  });

  it('calls indexer.safeRemove on archive and safeIndex on restore', async () => {
    const { service, repository, indexer } = buildService();
    repository.store.set('id-1', {
      id: 'id-1',
      question: 'q',
      answer: 'a',
      topic: 't',
      status: ReferenceAnswerStatus.ACTIVE,
    });

    await service.archive('id-1');
    expect(indexer.safeRemove).toHaveBeenCalledWith('id-1');

    await service.restore('id-1');
    expect(indexer.safeIndex).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'id-1', status: ReferenceAnswerStatus.ACTIVE }),
    );
  });

  it('archive and restore change status', async () => {
    const { service, repository } = buildService();
    repository.store.set('id-1', {
      id: 'id-1',
      question: 'q',
      answer: 'a',
      topic: 't',
      status: ReferenceAnswerStatus.ACTIVE,
    });

    const archived = await service.archive('id-1');
    expect(archived.status).toBe(ReferenceAnswerStatus.ARCHIVED);

    const restored = await service.restore('id-1');
    expect(restored.status).toBe(ReferenceAnswerStatus.ACTIVE);
  });

  it('archive on already-archived is a no-op that avoids extra save', async () => {
    const { service, repository } = buildService();
    repository.store.set('id-1', {
      id: 'id-1',
      question: 'q',
      answer: 'a',
      topic: 't',
      status: ReferenceAnswerStatus.ARCHIVED,
    });
    repository.save.mockClear();

    const result = await service.archive('id-1');
    expect(result.status).toBe(ReferenceAnswerStatus.ARCHIVED);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('findAll applies filters, sort and pagination via QueryBuilder', async () => {
    const { service, repository } = buildService();
    repository.qb.getManyAndCount.mockResolvedValueOnce([[{ id: 'x' }], 1]);

    const result = await service.findAll({
      page: 2,
      pageSize: 15,
      sortBy: ReferenceAnswerSortBy.Topic,
      sortDir: SortDir.Asc,
      search: 'CRM',
      topic: 'Цены',
      status: ReferenceAnswerStatus.ACTIVE,
    });

    expect(repository.qb.andWhere).toHaveBeenCalledTimes(3);
    expect(repository.orderCalls[0]).toEqual(['ref.topic', 'ASC']);
    expect(repository.qb.skip).toHaveBeenCalledWith(15);
    expect(repository.qb.take).toHaveBeenCalledWith(15);
    expect(result).toEqual({
      items: [{ id: 'x' }],
      total: 1,
      page: 2,
      pageSize: 15,
    });
  });
});
