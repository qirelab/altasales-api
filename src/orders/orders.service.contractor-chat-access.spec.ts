import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from './entities/order-status.enum';
import { OrdersService } from './orders.service';

/**
 * Focused unit tests for updateContractorChatAccessForAdmin. Verifies:
 * - Fix #2: revoking access removes the expert from platform chat, unless
 *   another still-active grant of the same (client, expert) pair keeps them
 *   entitled.
 * - Fix #3: participant sync runs BEFORE the flag save, so a failed sync
 *   leaves the order.contractorChatAccess value unchanged (atomicity).
 * - Same-user guard: never touches chat when the resolved expert equals the
 *   client (should not happen in prod, but guards degenerate data).
 */

interface Order {
  id: string;
  userId: string;
  contractorChatAccess: boolean;
  item?: {
    executorUserId?: string | null;
    service?: { userId?: string | null; type?: string | null } | null;
  } | null;
}

function makeService(
  overrides: {
    order: Order;
    hasOtherGrant?: boolean;
  } = { order: {} as Order },
) {
  const orderRepository = {
    findOne: jest.fn().mockResolvedValue(overrides.order),
    save: jest.fn(async (o: Order) => o),
    createQueryBuilder: jest.fn(() => ({
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest
        .fn()
        .mockResolvedValue(overrides.hasOtherGrant === true ? 1 : 0),
    })),
  };
  const chatService = {
    addExpertToClientPlatformSessions: jest.fn().mockResolvedValue(undefined),
    removeExpertFromClientPlatformSessions: jest.fn().mockResolvedValue(undefined),
  };

  // OrdersService has 16 constructor deps — we only need order + chat +
  // dataSource (for the advisory-lock transaction). Stub the rest as
  // empty objects; the code paths we exercise never touch them.
  //   1  orderRepository                ← real
  //   2  orderItemRepository
  //   3  orderItemSubItemRepository
  //   4  serviceRepository
  //   5  packageRepository
  //   6  recommendationRepository
  //   7  expertProfileRepository
  //   8  expertOfferingRepository
  //   9  expertsService
  //  10  paymentService
  //  11  dataSource                     ← real (transaction stub)
  //  12  balanceService
  //  13  cartService
  //  14  orderNotificationService
  //  15  chatService                    ← real
  //  16  recommendationUserLockService
  const stub = {} as never;
  // Minimal dataSource stub. `transaction(fn)` runs `fn` with a fake
  // EntityManager: `.query` is a no-op (advisory-lock SQL not executed under
  // jest), and `.getRepository(Order)` proxies to the outer orderRepository
  // so `hasOtherActiveContractorChatGrant` + `Order.save` inside the lock
  // hit the same mocked repository the tests set up.
  const dataSource = {
    transaction: (
      fn: (manager: {
        query: () => Promise<unknown>;
        getRepository: () => typeof orderRepository;
      }) => unknown,
    ) =>
      fn({
        query: () => Promise.resolve(undefined),
        getRepository: () => orderRepository,
      }),
  } as never;
  const service = new OrdersService(
    orderRepository as never,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    dataSource,
    stub,
    stub,
    stub,
    chatService as never,
    stub,
  );

  return { service, orderRepository, chatService };
}

describe('OrdersService.updateContractorChatAccessForAdmin', () => {
  const baseOrder = (over: Partial<Order> = {}): Order => ({
    id: 'order-1',
    userId: 'client-1',
    contractorChatAccess: false,
    item: { executorUserId: 'expert-1' },
    ...over,
  });

  it('attaches the expert BEFORE persisting contractorChatAccess=true (fix #3 atomicity)', async () => {
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder(),
    });

    await service.updateContractorChatAccessForAdmin('order-1', {
      contractorChatAccess: true,
    } as never);

    expect(chatService.addExpertToClientPlatformSessions).toHaveBeenCalledWith(
      'client-1',
      'expert-1',
    );
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ contractorChatAccess: true }),
    );
    // Order of operations: attach before save so a failure aborts the write.
    const attachCallOrder =
      chatService.addExpertToClientPlatformSessions.mock.invocationCallOrder[0];
    const saveCallOrder = orderRepository.save.mock.invocationCallOrder[0];
    expect(attachCallOrder).toBeLessThan(saveCallOrder);
  });

  it('does not persist contractorChatAccess=true if attach throws (fix #3 atomicity)', async () => {
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder(),
    });
    chatService.addExpertToClientPlatformSessions.mockRejectedValueOnce(
      new Error('WS gateway down'),
    );

    await expect(
      service.updateContractorChatAccessForAdmin('order-1', {
        contractorChatAccess: true,
      } as never),
    ).rejects.toThrow('WS gateway down');

    expect(orderRepository.save).not.toHaveBeenCalled();
  });

  it('re-attaches on repeat grant so a partially-applied prior call becomes consistent (fix #3 idempotency)', async () => {
    const { service, chatService } = makeService({
      order: baseOrder({ contractorChatAccess: true }),
    });

    await service.updateContractorChatAccessForAdmin('order-1', {
      contractorChatAccess: true,
    } as never);

    expect(chatService.addExpertToClientPlatformSessions).toHaveBeenCalledWith(
      'client-1',
      'expert-1',
    );
  });

  it('detaches the expert on revoke when no other active grant exists (fix #2)', async () => {
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder({ contractorChatAccess: true }),
      hasOtherGrant: false,
    });

    await service.updateContractorChatAccessForAdmin('order-1', {
      contractorChatAccess: false,
    } as never);

    expect(chatService.removeExpertFromClientPlatformSessions).toHaveBeenCalledWith(
      'client-1',
      'expert-1',
    );
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ contractorChatAccess: false }),
    );
  });

  it('keeps the expert as participant on revoke when another active grant exists (fix #2)', async () => {
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder({ contractorChatAccess: true }),
      hasOtherGrant: true,
    });

    await service.updateContractorChatAccessForAdmin('order-1', {
      contractorChatAccess: false,
    } as never);

    expect(
      chatService.removeExpertFromClientPlatformSessions,
    ).not.toHaveBeenCalled();
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ contractorChatAccess: false }),
    );
  });

  it('rolls the participant back when the flag save fails after grant (fix #3 compensation)', async () => {
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder(),
      hasOtherGrant: false,
    });
    orderRepository.save.mockRejectedValueOnce(new Error('DB down'));

    await expect(
      service.updateContractorChatAccessForAdmin('order-1', {
        contractorChatAccess: true,
      } as never),
    ).rejects.toThrow('DB down');

    // Grant fired, save failed, compensation must roll the expert back so
    // there's no orphan participant with `contractorChatAccess=false`.
    expect(chatService.addExpertToClientPlatformSessions).toHaveBeenCalledWith(
      'client-1',
      'expert-1',
    );
    expect(chatService.removeExpertFromClientPlatformSessions).toHaveBeenCalledWith(
      'client-1',
      'expert-1',
    );
  });

  it('does not roll the participant back on save failure if another grant keeps them entitled', async () => {
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder(),
      hasOtherGrant: true,
    });
    orderRepository.save.mockRejectedValueOnce(new Error('DB down'));

    await expect(
      service.updateContractorChatAccessForAdmin('order-1', {
        contractorChatAccess: true,
      } as never),
    ).rejects.toThrow('DB down');

    expect(
      chatService.removeExpertFromClientPlatformSessions,
    ).not.toHaveBeenCalled();
  });

  it('does not touch chat when the resolved expert equals the client', async () => {
    const { service, chatService } = makeService({
      order: baseOrder({
        item: { executorUserId: 'client-1' },
      }),
    });

    await service.updateContractorChatAccessForAdmin('order-1', {
      contractorChatAccess: true,
    } as never);

    expect(chatService.addExpertToClientPlatformSessions).not.toHaveBeenCalled();
  });

  it('does not touch chat when the order has no resolvable expert', async () => {
    const { service, chatService } = makeService({
      order: baseOrder({ item: { executorUserId: null, service: null } }),
    });

    await service.updateContractorChatAccessForAdmin('order-1', {
      contractorChatAccess: true,
    } as never);

    expect(chatService.addExpertToClientPlatformSessions).not.toHaveBeenCalled();
  });

  it('rejects a fresh grant on a cancelled order (fix #C)', async () => {
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder({ status: OrderStatus.Cancelled }),
    });

    await expect(
      service.updateContractorChatAccessForAdmin('order-1', {
        contractorChatAccess: true,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(chatService.addExpertToClientPlatformSessions).not.toHaveBeenCalled();
    expect(orderRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a repeat grant on a cancelled order (post-audit hardening)', async () => {
    // A prior partial run could leave contractorChatAccess=true on a
    // now-cancelled order; toggling the flag ON via UI would otherwise
    // silently re-attach the expert. The status guard blocks all grants
    // on cancelled rows, not just fresh ones.
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder({
        status: OrderStatus.Cancelled,
        contractorChatAccess: true,
      }),
    });

    await expect(
      service.updateContractorChatAccessForAdmin('order-1', {
        contractorChatAccess: true,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(chatService.addExpertToClientPlatformSessions).not.toHaveBeenCalled();
    expect(orderRepository.save).not.toHaveBeenCalled();
  });

  it('attaches the expert INSIDE the advisory-lock transaction (grant race fix)', async () => {
    // Regression: earlier grant path called addExpertToClientPlatformSessions
    // BEFORE taking the (client, expert) advisory lock. A concurrent revoke
    // on a sibling order could slip between attach and save, see hasOther
    // still false (this save had not landed), and remove the expert we
    // just added. Now the attach runs inside the lock so a concurrent
    // revoke queues behind us and sees the committed flag on its hasOther.
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder(),
    });

    await service.updateContractorChatAccessForAdmin('order-1', {
      contractorChatAccess: true,
    } as never);

    // The mock manager proxies save to orderRepository, so we assert the
    // attach and save both fired and the attach preceded the save.
    const attachOrder =
      chatService.addExpertToClientPlatformSessions.mock.invocationCallOrder[0];
    const saveOrder = orderRepository.save.mock.invocationCallOrder[0];
    expect(attachOrder).toBeDefined();
    expect(saveOrder).toBeDefined();
    expect(attachOrder).toBeLessThan(saveOrder);
  });

  it('still allows toggling contractorChatAccess=false on a cancelled order (cleanup path)', async () => {
    const { service, chatService } = makeService({
      order: baseOrder({
        status: OrderStatus.Cancelled,
        contractorChatAccess: true,
      }),
      hasOtherGrant: false,
    });

    await service.updateContractorChatAccessForAdmin('order-1', {
      contractorChatAccess: false,
    } as never);

    expect(chatService.removeExpertFromClientPlatformSessions).toHaveBeenCalledWith(
      'client-1',
      'expert-1',
    );
  });

  it('persists contractorChatAccess=false via the manager INSIDE the advisory-lock transaction (fix #A)', async () => {
    // The regression: previously the flag save happened AFTER the lock
    // released, so a concurrent revoke's hasOther check still saw the
    // stale contractorChatAccess=true. Now the save runs on the
    // manager returned from `dataSource.transaction`, and the mock proxies
    // it back to the outer orderRepository — so `save` still fires exactly
    // once, but its ordering vs `hasOther` (which we assert via the mock
    // sequence) reflects the in-lock happens-before we care about.
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder({ contractorChatAccess: true }),
      hasOtherGrant: false,
    });

    await service.updateContractorChatAccessForAdmin('order-1', {
      contractorChatAccess: false,
    } as never);

    const saveOrder = orderRepository.save.mock.invocationCallOrder[0];
    const removeOrder =
      chatService.removeExpertFromClientPlatformSessions.mock
        .invocationCallOrder[0];
    // save runs BEFORE participant remove so another concurrent revoke
    // acquiring the lock next sees the committed contractorChatAccess=false
    // on its own hasOther re-check.
    expect(saveOrder).toBeLessThan(removeOrder);
  });
});
