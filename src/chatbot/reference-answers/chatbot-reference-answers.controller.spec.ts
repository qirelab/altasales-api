import type { CurrentUserData } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../users/entities/user-role.enum';
import { ChatbotReferenceAnswersController } from './chatbot-reference-answers.controller';

function buildController() {
  const service = {
    create: jest.fn().mockResolvedValue({ id: 'ref-1' }),
    findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    findOne: jest.fn().mockResolvedValue({ id: 'ref-1' }),
    update: jest.fn().mockResolvedValue({ id: 'ref-1' }),
    archive: jest.fn().mockResolvedValue({ id: 'ref-1', status: 'archived' }),
    restore: jest.fn().mockResolvedValue({ id: 'ref-1', status: 'active' }),
  };
  const controller = new ChatbotReferenceAnswersController(service as never);
  return { controller, service };
}

const currentUser: CurrentUserData = {
  id: 'user-1',
  uid: 'uid-1',
  email: 'admin@example.com',
  emailVerified: true,
  role: UserRole.ADMIN,
};

describe('ChatbotReferenceAnswersController', () => {
  it('forwards create call with current user id', async () => {
    const { controller, service } = buildController();
    const dto = { question: 'q', answer: 'a', topic: 't' };

    await controller.create(dto, currentUser);

    expect(service.create).toHaveBeenCalledWith(dto, 'user-1');
  });

  it('forwards findAll query to service', async () => {
    const { controller, service } = buildController();
    const query = { page: 1, pageSize: 10 } as never;

    await controller.findAll(query);

    expect(service.findAll).toHaveBeenCalledWith(query);
  });

  it('forwards findOne id to service', async () => {
    const { controller, service } = buildController();
    await controller.findOne('ref-1');
    expect(service.findOne).toHaveBeenCalledWith('ref-1');
  });

  it('forwards update call with id and dto', async () => {
    const { controller, service } = buildController();
    const dto = { topic: 'Цены' };

    await controller.update('ref-1', dto);

    expect(service.update).toHaveBeenCalledWith('ref-1', dto);
  });

  it('archive triggers service.archive', async () => {
    const { controller, service } = buildController();
    await controller.archive('ref-1');
    expect(service.archive).toHaveBeenCalledWith('ref-1');
  });

  it('restore triggers service.restore', async () => {
    const { controller, service } = buildController();
    await controller.restore('ref-1');
    expect(service.restore).toHaveBeenCalledWith('ref-1');
  });
});
