export type CoverageRight = { id: string; status: string; serviceCode: string };
export type CoverageSubscription = {
  id: string;
  status: string;
  startsOn: Date;
  endsOn: Date;
  balance: { lte(value: number): boolean; gt(value: number): boolean };
  serviceSnapshot: unknown;
  planVersion: { services: unknown };
  rights: CoverageRight[];
};
export type CoverageFailure = 'SERVICE_NOT_COVERED'|'NOT_ACTIVE'|'EXPIRED'|'PAYMENT_RESTRICTED'|'RIGHT_RESERVED'|'RIGHT_CONSUMED'|'QUOTA_UNAVAILABLE';

function servicesOf(subscription: CoverageSubscription): string[] {
  const snapshot=subscription.serviceSnapshot as {services?:unknown}|null;
  const values=Array.isArray(snapshot?.services)?snapshot.services:subscription.planVersion.services;
  return Array.isArray(values)?values.filter((value):value is string=>typeof value==='string'):[];
}
function eligibleDay(subscription:CoverageSubscription,businessDate:Date):boolean {
  const snapshot=subscription.serviceSnapshot as {eligibleDays?:unknown}|null;
  if(!Array.isArray(snapshot?.eligibleDays))return true;
  return snapshot.eligibleDays.includes(businessDate.getUTCDay());
}

export function selectMealCoverage(subscriptions: CoverageSubscription[], businessDate: Date, serviceCode: string): { rightId:string|null; failure:CoverageFailure|null } {
  if(!subscriptions.length)return {rightId:null,failure:null};
  const day=businessDate.toISOString().slice(0,10);
  const supports=(subscription:CoverageSubscription)=>{const services=servicesOf(subscription);return services.includes(serviceCode)||(services.includes('MAIN')&&(serviceCode==='LUNCH'||serviceCode==='DINNER'));};
  const matching=subscriptions.filter(supports);
  if(!matching.length)return {rightId:null,failure:'SERVICE_NOT_COVERED'};
  const eligible=matching.filter(subscription=>subscription.status==='ACTIVE'&&subscription.startsOn.toISOString().slice(0,10)<=day&&subscription.endsOn.toISOString().slice(0,10)>=day&&eligibleDay(subscription,businessDate)&&subscription.balance.lte(0));
  const available=eligible.flatMap(subscription=>subscription.rights.filter(right=>right.status==='AVAILABLE'&&(right.serviceCode===serviceCode||(right.serviceCode==='MAIN'&&(serviceCode==='LUNCH'||serviceCode==='DINNER')))).map(right=>right.id));
  if(available.length)return {rightId:available[0],failure:null};
  if(eligible.some(subscription=>subscription.rights.some(right=>right.status==='RESERVED')))return {rightId:null,failure:'RIGHT_RESERVED'};
  if(eligible.some(subscription=>subscription.rights.some(right=>right.status==='CONSUMED')))return {rightId:null,failure:'RIGHT_CONSUMED'};
  if(eligible.length)return {rightId:null,failure:'QUOTA_UNAVAILABLE'};
  if(matching.some(subscription=>subscription.status==='EXPIRED'||subscription.endsOn.toISOString().slice(0,10)<day))return {rightId:null,failure:'EXPIRED'};
  if(matching.some(subscription=>subscription.status==='SUSPENDED'))return {rightId:null,failure:'NOT_ACTIVE'};
  if(matching.some(subscription=>subscription.balance.gt(0)))return {rightId:null,failure:'PAYMENT_RESTRICTED'};
  if(matching.some(subscription=>subscription.status!=='ACTIVE'||subscription.startsOn.toISOString().slice(0,10)>day))return {rightId:null,failure:'NOT_ACTIVE'};
  return {rightId:null,failure:'QUOTA_UNAVAILABLE'};
}

export function calculateMealCoverage(unitBaseAmount:number, quantity:number, availableRights:number) {
  const coveredQuantity=Math.min(quantity,availableRights);
  const coveredAmount=Math.min(unitBaseAmount*coveredQuantity,unitBaseAmount*quantity);
  return {coveredQuantity,coveredAmount,amountDue:Math.max(0,unitBaseAmount*quantity-coveredAmount)};
}
