export type ManualCourierAvailability='AVAILABLE'|'UNAVAILABLE';

export function effectiveCourierAvailability(manual:ManualCourierAvailability,activeMissions:number,capacity:number):'AVAILABLE'|'BUSY'|'UNAVAILABLE' {
  if(manual==='UNAVAILABLE')return 'UNAVAILABLE';
  return activeMissions>=capacity?'BUSY':'AVAILABLE';
}

export function courierCanAccept(manual:ManualCourierAvailability,activeMissions:number,capacity:number):boolean {
  return manual==='AVAILABLE'&&activeMissions<capacity;
}

export function rankCouriers<T extends {activeMissions:number;firstName:string;lastName:string;id:string}>(couriers:T[]):T[] {
  return [...couriers].sort((a,b)=>a.activeMissions-b.activeMissions||a.firstName.localeCompare(b.firstName)||a.lastName.localeCompare(b.lastName)||a.id.localeCompare(b.id));
}
