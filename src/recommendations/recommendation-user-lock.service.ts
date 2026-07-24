import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity';

@Injectable()
export class RecommendationUserLockService {
  constructor(private readonly dataSource: DataSource) {}

  async lockUser(userId: string, manager: EntityManager): Promise<void> {
    await manager.getRepository(User).findOne({
      where: { id: userId },
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async withUserLock<T>(
    userId: string,
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockUser(userId, manager);
      return operation(manager);
    });
  }
}
