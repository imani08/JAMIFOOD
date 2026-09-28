import { DomainError } from './http';
import { audit, Tx } from './transaction';

export async function consumeReservedMealRight(tx:Tx,input:{mealRightId:string;orderId:string;actorId:string;idempotencyKey:string}) {
  await tx.$queryRaw`SELECT id FROM "MealRight" WHERE id = ${input.mealRightId}::uuid FOR UPDATE`;
  const right=await tx.mealRight.findUniqueOrThrow({where:{id:input.mealRightId}});
  if(right.status!=='RESERVED')throw new DomainError('MEAL_RIGHT_UNAVAILABLE','Le droit réservé ne peut plus être consommé.');
  const consumption=await tx.mealConsumption.create({data:{mealRightId:right.id,orderId:input.orderId,servedById:input.actorId,idempotencyKey:input.idempotencyKey}});
  await tx.mealRight.update({where:{id:right.id},data:{status:'CONSUMED',consumedAt:consumption.consumedAt}});
  await audit(tx,input.actorId,'MEAL_CONSUMED','MealRight',right.id,{orderId:input.orderId,consumptionId:consumption.id});
  return consumption;
}
