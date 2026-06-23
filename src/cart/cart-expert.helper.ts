import { ExpertPositionDetailDto } from '../experts/experts.service';
import { CartItem } from './entities/cart-item.entity';

export interface CartExpertOfferingDto {
  cartItemOfferingId: string;
  offeringId: string;
  name: string;
  description: string | null;
  price: number | null;
  quantity: number;
}

export interface CartExpertItemDto {
  id: string;
  quantity: number;
  expertPositionId: string;
  expertPosition: { id: string; name: string; description: string };
  executorUserId: string;
  executor: { id: string; name: string; lastName: string };
  offerings: CartExpertOfferingDto[];
  amount: number;
}

export function mapCartExpertItem(
  item: CartItem,
  position: ExpertPositionDetailDto,
): CartExpertItemDto | null {
  if (!item.expertPositionId || !item.executorUserId) return null;

  const executor = position.executors.find((e) => e.id === item.executorUserId);
  if (!executor) return null;

  const offerings: CartExpertOfferingDto[] = [...(item.offerings ?? [])]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((entry) => {
      const offeringDef = position.offerings.find((o) => o.id === entry.expertPositionOfferingId);
      const priceEntry = executor.offerings.find((po) => po.offeringId === entry.expertPositionOfferingId);
      return {
        cartItemOfferingId: entry.id,
        offeringId: entry.expertPositionOfferingId,
        name: offeringDef?.name ?? '—',
        description: offeringDef?.description ?? null,
        price: priceEntry?.price ?? null,
        quantity: entry.quantity,
      };
    });

  if (offerings.length === 0) return null;
  if (offerings.some((o) => o.price == null)) return null;

  const amount = offerings.reduce((sum, o) => sum + ((o.price ?? 0) * o.quantity), 0);

  return {
    id: item.id,
    quantity: item.quantity,
    expertPositionId: item.expertPositionId,
    expertPosition: {
      id: position.id,
      name: position.name,
      description: position.description,
    },
    executorUserId: item.executorUserId,
    executor: {
      id: executor.id,
      name: executor.name,
      lastName: executor.lastName,
    },
    offerings,
    amount,
  };
}
