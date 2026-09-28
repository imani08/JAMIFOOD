import { describe, expect, it } from 'vitest';
import { calculateMealCoverage, CoverageSubscription, selectMealCoverage } from './subscription-coverage';

const today=new Date('2026-09-28T00:00:00.000Z');
function subscription(overrides:Partial<CoverageSubscription>={}):CoverageSubscription{return{id:'sub-1',status:'ACTIVE',startsOn:new Date('2026-09-01T00:00:00.000Z'),endsOn:new Date('2026-09-30T00:00:00.000Z'),balance:{lte:(value:number)=>value>=0,gt:(value:number)=>value<0},serviceSnapshot:{services:['LUNCH']},planVersion:{services:['LUNCH']},rights:[{id:'right-1',status:'AVAILABLE',serviceCode:'LUNCH'}],...overrides};}

describe('subscription meal coverage policy',()=>{
  it('selects an available active right only for the covered service and period',()=>{
    expect(selectMealCoverage([subscription()],today,'LUNCH')).toEqual({rightId:'right-1',failure:null});
    expect(selectMealCoverage([subscription()],today,'DINNER').failure).toBe('SERVICE_NOT_COVERED');
    expect(selectMealCoverage([subscription({status:'EXPIRED'})],today,'LUNCH').failure).toBe('EXPIRED');
    expect(selectMealCoverage([subscription({serviceSnapshot:{services:['LUNCH'],eligibleDays:[2]}})],today,'LUNCH').failure).toBe('QUOTA_UNAVAILABLE');
  });
  it('does not reuse reserved or consumed quota rights',()=>{
    expect(selectMealCoverage([subscription({rights:[{id:'right-1',status:'RESERVED',serviceCode:'LUNCH'}]})],today,'LUNCH').failure).toBe('RIGHT_RESERVED');
    expect(selectMealCoverage([subscription({rights:[{id:'right-1',status:'CONSUMED',serviceCode:'LUNCH'}]})],today,'LUNCH').failure).toBe('RIGHT_CONSUMED');
  });
  it('blocks financially restricted subscriptions and covers only the available meal quantity',()=>{
    const restricted=subscription({balance:{lte:()=>false,gt:()=>true}});
    expect(selectMealCoverage([restricted],today,'LUNCH').failure).toBe('PAYMENT_RESTRICTED');
    expect(calculateMealCoverage(8000,2,1)).toEqual({coveredQuantity:1,coveredAmount:8000,amountDue:8000});
    expect(calculateMealCoverage(8000,1,1)).toEqual({coveredQuantity:1,coveredAmount:8000,amountDue:0});
  });
});
