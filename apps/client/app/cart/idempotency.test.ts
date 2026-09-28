import { describe, expect, it } from 'vitest';
import { getOrderAttempt, invalidateOrderAttempt, OrderAttemptPayload } from './idempotency';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => { values.set(key,value); }, removeItem: (key:string) => { values.delete(key); } };
}
const base:OrderAttemptPayload={menuVersionId:'menu-a',serviceCode:'LUNCH',businessDate:'2026-09-28',serviceMode:'TAKEAWAY',currency:'CDF',items:[{productId:'meal',quantity:1,variant:'Riz',optionSelections:[{groupId:'addons',optionIds:['foufou']}]}]};

describe('client order idempotency lifecycle',()=>{
  it('reuses a key for the exact same POST after retry or double click',()=>{
    const storage=memoryStorage();let sequence=0;const key=()=>`key-${++sequence}`;
    const first=getOrderAttempt(storage,base,key);const retry=getOrderAttempt(storage,base,key);const doubleClick=getOrderAttempt(storage,base,key);
    expect(retry.key).toBe(first.key);expect(doubleClick.key).toBe(first.key);expect(sequence).toBe(1);
  });
  it('creates a new key when cart contents or quantity change',()=>{
    const storage=memoryStorage();let sequence=0;const key=()=>`key-${++sequence}`;
    const first=getOrderAttempt(storage,base,key);
    expect(getOrderAttempt(storage,{...base,items:[...base.items,{productId:'foufou-side',quantity:1}]},key).key).not.toBe(first.key);
    expect(getOrderAttempt(storage,{...base,items:[{...base.items[0],quantity:2}]},key).key).not.toBe(first.key);
  });
  it('creates a new key when the customer explicitly accepts the unit price instead of an unavailable subscription right',()=>{
    const storage=memoryStorage();let sequence=0;const key=()=>`key-${++sequence}`;
    const first=getOrderAttempt(storage,base,key);
    const accepted=getOrderAttempt(storage,{...base,acceptUnitPrice:true},key);
    expect(accepted.key).not.toBe(first.key);
    expect(getOrderAttempt(storage,{...base,acceptUnitPrice:true},key).key).toBe(accepted.key);
  });
  it('creates a new key when service, variant, or supplement changes',()=>{
    const storage=memoryStorage();let sequence=0;const key=()=>`key-${++sequence}`;
    const first=getOrderAttempt(storage,base,key);
    expect(getOrderAttempt(storage,{...base,serviceMode:'DINE_IN'},key).key).not.toBe(first.key);
    expect(getOrderAttempt(storage,{...base,items:[{...base.items[0],variant:'Frites'}]},key).key).not.toBe(first.key);
    expect(getOrderAttempt(storage,{...base,items:[{...base.items[0],optionSelections:[{groupId:'addons',optionIds:['sauce']}]}]},key).key).not.toBe(first.key);
  });
  it('creates a new key when delivery details or service mode change',()=>{
    const storage=memoryStorage();let sequence=0;const key=()=>`key-${++sequence}`;
    const first=getOrderAttempt(storage,{...base,serviceMode:'DELIVERY',delivery:{recipientName:'Imani',contactPhone:'+243800000000',dropoffPoint:'Home A'}},key);
    expect(getOrderAttempt(storage,{...base,serviceMode:'DELIVERY',delivery:{recipientName:'Imani',contactPhone:'+243800000000',dropoffPoint:'Home B'}},key).key).not.toBe(first.key);
    expect(getOrderAttempt(storage,{...base,serviceMode:'TAKEAWAY'},key).key).not.toBe(first.key);
  });
  it('creates a new key when the menu version changes and after explicit mutation invalidation',()=>{
    const storage=memoryStorage();let sequence=0;const key=()=>`key-${++sequence}`;
    const first=getOrderAttempt(storage,base,key);
    expect(getOrderAttempt(storage,{...base,menuVersionId:'menu-b'},key).key).not.toBe(first.key);
    invalidateOrderAttempt(storage);
    expect(getOrderAttempt(storage,base,key).key).not.toBe(first.key);
  });
  it('creates a new key when the menu service or business date changes',()=>{
    const storage=memoryStorage();let sequence=0;const key=()=>`key-${++sequence}`;
    const first=getOrderAttempt(storage,base,key);
    expect(getOrderAttempt(storage,{...base,serviceCode:'BREAKFAST'},key).key).not.toBe(first.key);
    expect(getOrderAttempt(storage,{...base,businessDate:'2026-09-29'},key).key).not.toBe(first.key);
  });
  it('binds an idempotency key to the selected service and date',()=>{
    const storage=memoryStorage();let sequence=0;const key=()=>`key-${++sequence}`;
    const first=getOrderAttempt(storage,base,key);
    expect(getOrderAttempt(storage,{...base,serviceCode:'BREAKFAST'},key).key).not.toBe(first.key);
    expect(getOrderAttempt(storage,{...base,businessDate:'2026-09-29'},key).key).not.toBe(first.key);
  });
});
