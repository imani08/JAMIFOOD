import { describe, expect, it } from 'vitest';
import { getOrderAttempt, invalidateOrderAttempt, OrderAttemptPayload } from './idempotency';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => { values.set(key,value); }, removeItem: (key:string) => { values.delete(key); } };
}
const base:OrderAttemptPayload={menuVersionId:'menu-a',serviceMode:'TAKEAWAY',currency:'CDF',items:[{productId:'meal',quantity:1,variant:'Riz',optionSelections:[{groupId:'addons',optionIds:['foufou']}]}]};

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
  it('creates a new key when service, variant, or supplement changes',()=>{
    const storage=memoryStorage();let sequence=0;const key=()=>`key-${++sequence}`;
    const first=getOrderAttempt(storage,base,key);
    expect(getOrderAttempt(storage,{...base,serviceMode:'DINE_IN'},key).key).not.toBe(first.key);
    expect(getOrderAttempt(storage,{...base,items:[{...base.items[0],variant:'Frites'}]},key).key).not.toBe(first.key);
    expect(getOrderAttempt(storage,{...base,items:[{...base.items[0],optionSelections:[{groupId:'addons',optionIds:['sauce']}]}]},key).key).not.toBe(first.key);
  });
  it('creates a new key when the menu version changes and after explicit mutation invalidation',()=>{
    const storage=memoryStorage();let sequence=0;const key=()=>`key-${++sequence}`;
    const first=getOrderAttempt(storage,base,key);
    expect(getOrderAttempt(storage,{...base,menuVersionId:'menu-b'},key).key).not.toBe(first.key);
    invalidateOrderAttempt(storage);
    expect(getOrderAttempt(storage,base,key).key).not.toBe(first.key);
  });
});
