import { ConflictException, NotFoundException } from '@nestjs/common';
import { PackagesService } from './packages.service';
import { ServicePackage } from './entities/package.entity';

interface QueryBuilderMock {
  leftJoinAndSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  getOne: jest.Mock;
  getMany: jest.Mock;
}

const makeQueryBuilder = (overrides: Partial<QueryBuilderMock> = {}): QueryBuilderMock => {
  const qb: QueryBuilderMock = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
    getMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return qb;
};

const makePackage = (overrides: Partial<ServicePackage> = {}): ServicePackage => ({
  id: 'pkg-1',
  name: 'CRM Старт',
  description: 'desc',
  tags: [],
  packageType: 'Start',
  price: 0,
  giftEligible: false,
  isHidden: false,
  image: null,
  imageOriginal: null,
  categories: [],
  category: null,
  categoryId: null,
  services: [],
  createdAt: new Date(),
  deletedAt: null,
  assignLegacyCategoryFields: jest.fn(),
  ...overrides,
} as unknown as ServicePackage);

const makeService = () => {
  const packageRepository = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn((value) => Promise.resolve(value)),
    remove: jest.fn(),
  };
  const serviceRepository = { find: jest.fn() };
  const categoryRepository = { find: jest.fn() };
  const orderRepository = { createQueryBuilder: jest.fn() };
  const orderItemRepository = { count: jest.fn(), createQueryBuilder: jest.fn() };
  const dataSource = { query: jest.fn() };

  const service = new PackagesService(
    packageRepository as never,
    serviceRepository as never,
    categoryRepository as never,
    orderRepository as never,
    orderItemRepository as never,
    dataSource as never,
  );

  return {
    service,
    packageRepository,
    serviceRepository,
    categoryRepository,
  };
};

describe('PackagesService.findAll (public list)', () => {
  it('joins services with active + non-hidden filter', async () => {
    const { service, packageRepository } = makeService();
    const qb = makeQueryBuilder({ getMany: jest.fn().mockResolvedValue([]) });
    packageRepository.createQueryBuilder.mockReturnValue(qb);

    await service.findAll();

    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
      'sp.services',
      's',
      's."deletedAt" IS NULL AND s."isHidden" = false',
    );
  });

  it('wraps the categories OR-clause in parentheses', async () => {
    const { service, packageRepository } = makeService();
    const qb = makeQueryBuilder({ getMany: jest.fn().mockResolvedValue([]) });
    packageRepository.createQueryBuilder.mockReturnValue(qb);

    await service.findAll();

    const categoryClause = qb.andWhere.mock.calls
      .map((call) => call[0] as string)
      .find((sql) => sql.includes('NOT EXISTS') && sql.includes('OR category.id IS NOT NULL'));

    expect(categoryClause).toBeDefined();
    expect(categoryClause!.trim().startsWith('(')).toBe(true);
    expect(categoryClause!.trim().endsWith(')')).toBe(true);
  });
});

describe('PackagesService.create — name normalization', () => {
  it('trims and collapses whitespace before uniqueness check and save', async () => {
    const { service, packageRepository } = makeService();
    const conflictQb = makeQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) });
    packageRepository.createQueryBuilder.mockReturnValue(conflictQb);
    packageRepository.findOne.mockResolvedValue(makePackage());

    await service.create({ name: '  CRM   Золото  ', serviceIds: [] } as never);

    expect(conflictQb.where).toHaveBeenCalledWith(
      'LOWER(sp.name) = LOWER(:name)',
      { name: 'CRM Золото' },
    );
    const created = packageRepository.create.mock.calls[0][0];
    expect(created.name).toBe('CRM Золото');
  });
});

describe('PackagesService.findOne (public)', () => {
  it('joins services with active + non-hidden filter', async () => {
    const { service, packageRepository } = makeService();
    const qb = makeQueryBuilder({ getOne: jest.fn().mockResolvedValue(makePackage()) });
    packageRepository.createQueryBuilder.mockReturnValue(qb);

    await service.findOne('pkg-1');

    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
      'sp.services',
      's',
      's."deletedAt" IS NULL AND s."isHidden" = false',
    );
  });

  it('wraps the categories OR-clause in parentheses to preserve AND precedence', async () => {
    const { service, packageRepository } = makeService();
    const qb = makeQueryBuilder({ getOne: jest.fn().mockResolvedValue(makePackage()) });
    packageRepository.createQueryBuilder.mockReturnValue(qb);

    await service.findOne('pkg-1');

    const categoryClause = qb.andWhere.mock.calls
      .map((call) => call[0] as string)
      .find((sql) => sql.includes('NOT EXISTS') && sql.includes('OR category.id IS NOT NULL'));

    expect(categoryClause).toBeDefined();
    expect(categoryClause!.trim().startsWith('(')).toBe(true);
    expect(categoryClause!.trim().endsWith(')')).toBe(true);
  });

  it('throws NotFoundException when the query returns nothing', async () => {
    const { service, packageRepository } = makeService();
    const qb = makeQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) });
    packageRepository.createQueryBuilder.mockReturnValue(qb);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PackagesService.create (name uniqueness)', () => {
  it('rejects a duplicate name case-insensitively', async () => {
    const { service, packageRepository } = makeService();
    const conflictQb = makeQueryBuilder({ getOne: jest.fn().mockResolvedValue(makePackage()) });
    packageRepository.createQueryBuilder.mockReturnValue(conflictQb);

    await expect(
      service.create({ name: 'crm старт' } as never),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(conflictQb.where).toHaveBeenCalledWith(
      'LOWER(sp.name) = LOWER(:name)',
      { name: 'crm старт' },
    );
  });

  it('excludes soft-deleted rows when checking uniqueness', async () => {
    const { service, packageRepository } = makeService();
    const conflictQb = makeQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) });
    packageRepository.createQueryBuilder.mockReturnValue(conflictQb);
    packageRepository.findOne.mockResolvedValue(makePackage());

    await service.create({ name: 'Новый пакет', serviceIds: [] } as never);

    expect(conflictQb.andWhere).toHaveBeenCalledWith('sp."deletedAt" IS NULL');
  });
});

describe('PackagesService.update', () => {
  it('loads the package through the admin filter with categories + services relations', async () => {
    const { service, packageRepository } = makeService();
    const existing = makePackage({ name: 'CRM Старт', services: [{ id: 's1' } as never] });
    packageRepository.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);

    await service.update('pkg-1', {} as never);

    expect(packageRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        relations: ['categories', 'services'],
      }),
    );
    const call = packageRepository.findOne.mock.calls[0][0];
    expect(call.where).toEqual(expect.objectContaining({ id: 'pkg-1' }));
    expect('isHidden' in call.where).toBe(false);
  });

  it('keeps existing services when serviceIds is not provided in the DTO', async () => {
    const { service, packageRepository } = makeService();
    const existingServices = [{ id: 's1' } as never, { id: 's2' } as never];
    const existing = makePackage({ name: 'CRM Старт', services: existingServices });
    packageRepository.findOne
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);

    await service.update('pkg-1', { description: 'new description' } as never);

    const saved = packageRepository.save.mock.calls[0][0];
    expect(saved.services).toBe(existingServices);
  });

  it('skips the name-uniqueness check when the name is unchanged', async () => {
    const { service, packageRepository } = makeService();
    const existing = makePackage({ name: 'CRM Старт' });
    packageRepository.findOne
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);

    await service.update('pkg-1', { name: 'CRM Старт' } as never);

    expect(packageRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('throws ConflictException when the new name conflicts with another package', async () => {
    const { service, packageRepository } = makeService();
    const existing = makePackage({ name: 'CRM Старт' });
    packageRepository.findOne.mockResolvedValueOnce(existing);
    const conflictQb = makeQueryBuilder({
      getOne: jest.fn().mockResolvedValue(makePackage({ id: 'pkg-2' })),
    });
    packageRepository.createQueryBuilder.mockReturnValue(conflictQb);

    await expect(
      service.update('pkg-1', { name: 'CRM Золото' } as never),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(conflictQb.andWhere).toHaveBeenCalledWith(
      'sp.id != :excludeId',
      { excludeId: 'pkg-1' },
    );
  });
});
