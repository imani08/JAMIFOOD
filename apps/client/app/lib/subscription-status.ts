export type SubscriptionStatusRow={status?:unknown;balance?:unknown;endsOn?:unknown};
export function subscriptionStatus(row:SubscriptionStatusRow,now=new Date()):{label:string;kind:'active'|'warning'|'pending'|'expired'} {
 const end=String(row.endsOn??'').slice(0,10);const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kinshasa',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);const days=end?Math.floor((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000):Infinity;
 if(row.status==='EXPIRED'||(end&&end<today))return {label:'Expiré',kind:'expired'};
 if(row.status==='PENDING_PAYMENT'||Number(row.balance)>0)return {label:'Paiement en attente',kind:'pending'};
 if(row.status==='CANCELLED')return {label:'Annulé',kind:'expired'};
 if(row.status==='SUSPENDED')return {label:'Suspendu',kind:'expired'};
 const warningDays=Number(process.env.NEXT_PUBLIC_SUBSCRIPTION_EXPIRY_WARNING_DAYS??3);
 if(days>=0&&days<=warningDays)return {label:'Expire bientôt',kind:'warning'};
 return {label:row.status==='SCHEDULED'?'À venir':'Actif',kind:'active'};
}
