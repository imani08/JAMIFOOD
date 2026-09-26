import { expect, it } from 'vitest';
import { Prisma } from '@jami/database';
import { netPaymentReceived } from './refund-value';
const d=(value:string)=>new Prisma.Decimal(value);
it('refunds net 8 when tender is 10 and change is 2',()=>{
  const net=netPaymentReceived({receivedAmount:d('10'),receivedCurrency:'USD',changeAmount:d('2'),changeCurrency:'USD',exchangeRateSnapshot:null});
  expect(net.toString()).toBe('8');
  expect(d('8').gte(net)).toBe(true);
  expect(net.sub(d('8')).toString()).toBe('0');
});
it('subtracts change using only the historical exchange rate',()=>{
  expect(netPaymentReceived({receivedAmount:d('5'),receivedCurrency:'USD',changeAmount:d('2800'),changeCurrency:'CDF',exchangeRateSnapshot:d('2500')}).toString()).toBe('3.88');
});
it('does not invent a rounding policy',()=>{
  expect(()=>netPaymentReceived({receivedAmount:d('5'),receivedCurrency:'USD',changeAmount:d('1'),changeCurrency:'CDF',exchangeRateSnapshot:d('2500')})).toThrow();
});
