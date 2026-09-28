import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@jami/database';
import { confirmOrderAndIssueKitchenTicket } from './kitchen-ticket';
import type { Tx } from './transaction';

describe('automatic kitchen ticket issuance',()=>{
  it('confirms an order without a payment record and includes meal options for the kitchen',async()=>{
    const update=vi.fn();
    const tx={order:{update}} as unknown as Tx;
    await confirmOrderAndIssueKitchenTicket(tx,{
      id:'order-1',number:'WEB-2026-1',serviceMode:'TAKEAWAY',
      items:[{quantity:new Prisma.Decimal(1),productSnapshot:{name:'Repas complet'},variantsSnapshot:{Accompagnement:'Foufou'},supplementsSnapshot:[{name:'Sauce',quantity:1,unitPrice:'500'}]}],
    },null);
    expect(update).toHaveBeenCalledTimes(1);
    const payload=update.mock.calls[0][0];
    expect(payload.data.status).toBe('CONFIRMED');
    expect(payload.data.statusHistory.create).toMatchObject({fromStatus:'RECEIVED',toStatus:'CONFIRMED',actorId:null});
    expect(payload.data.kitchenTicket.create.number).toBe('K-WEB-2026-1');
    expect(payload.data.kitchenTicket.create.items.create[0].preparationSnapshot).toMatchObject({name:'Repas complet',variants:{Accompagnement:'Foufou'},supplements:[{name:'Sauce',quantity:1,unitPrice:'500'}]});
  });
});
