import { describe, expect, it, vi } from 'vitest';
import { consumeReservedMealRight } from './meal-consumption';
import type { Tx } from './transaction';

describe('subscription right handover consumption',()=>{
  it('consumes a reservation once and refuses a second handover attempt',async()=>{
    let status='RESERVED';
    const create=vi.fn(async()=>({id:'consumption-1',consumedAt:new Date()}));
    const tx={
      $queryRaw:vi.fn(),
      mealRight:{findUniqueOrThrow:vi.fn(async()=>({id:'right-1',status})),update:vi.fn(async({data}:{data:{status:string}})=>{status=data.status;return{id:'right-1',status};})},
      mealConsumption:{create},
      auditLog:{create:vi.fn()},
    } as unknown as Tx;
    await expect(consumeReservedMealRight(tx,{mealRightId:'right-1',orderId:'order-1',actorId:'staff-1',idempotencyKey:'serve-key'})).resolves.toMatchObject({id:'consumption-1'});
    await expect(consumeReservedMealRight(tx,{mealRightId:'right-1',orderId:'order-1',actorId:'staff-1',idempotencyKey:'serve-key-retry'})).rejects.toMatchObject({code:'MEAL_RIGHT_UNAVAILABLE'});
    expect(create).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
