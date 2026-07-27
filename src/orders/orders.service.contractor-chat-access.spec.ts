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
    addExpertToClientPlatformChat: jest.fn().mockResolvedValue(undefined),
    removeExpertFromClientPlatformChat: jest.fn().mockResolvedValue(undefined),
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
  // Minimal dataSource stub: `transaction(fn)` just runs `fn` with a fake
  // manager that has a no-op `query`. The advisory-lock SQL is not executed
  // by jest; we only need `withClientExpertLock` to not blow up.
  const dataSource = {
    transaction: (
      fn: (manager: { query: () => Promise<unknown> }) => unknown,
    ) => fn({ query: () => Promise.resolve(undefined) }),
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

    expect(chatService.addExpertToClientPlatformChat).toHaveBeenCalledWith(
      'client-1',
      'expert-1',
    );
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ contractorChatAccess: true }),
    );
    // Order of operations: attach before save so a failure aborts the write.
    const attachCallOrder =
      chatService.addExpertToClientPlatformChat.mock.invocationCallOrder[0];
    const saveCallOrder = orderRepository.save.mock.invocationCallOrder[0];
    expect(attachCallOrder).toBeLessThan(saveCallOrder);
  });

  it('does not persist contractorChatAccess=true if attach throws (fix #3 atomicity)', async () => {
    const { service, orderRepository, chatService } = makeService({
      order: baseOrder(),
    });
    chatService.addExpertToClientPlatformChat.mockRejectedValueOnce(
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

    expect(chatService.addExpertToClientPlatformChat).toHaveBeenCalledWith(
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

    expect(chatService.removeExpertFromClientPlatformChat).toHaveBeenCalledWith(
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
      chatService.removeExpertFromClientPlatformChat,
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
    expect(chatService.addExpertToClientPlatformChat).toHaveBeenCalledWith(
      'client-1',
      'expert-1',
    );
    expect(chatService.removeExpertFromClientPlatformChat).toHaveBeenCalledWith(
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
      chatService.removeExpertFromClientPlatformChat,
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

    expect(chatService.addExpertToClientPlatformChat).not.toHaveBeenCalled();
  });

  it('does not touch chat when the order has no resolvable expert', async () => {
    const { service, chatService } = makeService({
      order: baseOrder({ item: { executorUserId: null, service: null } }),
    });

    await service.updateContractorChatAccessForAdmin('order-1', {
      contractorChatAccess: true,
    } as never);

    expect(chatService.addExpertToClientPlatformChat).not.toHaveBeenCalled();
  });
});
