import { Prisma } from '@jami/database';
import { DomainError } from './http';
export function netPaymentReceived(payment: {receivedAmount: Prisma.Decimal; receivedCurrency: string; changeAmount: Prisma.Decimal; changeCurrency: string | null; exchangeRateSnapshot: Prisma.Decimal | null}) {
  let change = payment.changeAmount;
  if (change.gt(0) && payment.changeCurrency !== payment.receivedCurrency) {
    const rate = payment.exchangeRateSnapshot;
    if (!rate?.gt(0)) throw new DomainError('RATE_REQUIRED', 'Le taux historique du paiement est nécessaire au remboursement.');
    change = payment.receivedCurrency === 'USD' ? change.div(rate) : change.mul(rate);
  }
  const net = payment.receivedAmount.sub(change);
  if (!net.eq(net.toDecimalPlaces(2))) throw new DomainError('ROUNDING_RULE_REQUIRED', 'Le remboursement nécessite une règle d’arrondi validée.');
  return net;
}
