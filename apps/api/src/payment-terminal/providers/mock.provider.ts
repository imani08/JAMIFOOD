import { Injectable } from '@nestjs/common';
import { DomainError } from '../../http';
import type { PaymentTerminalProvider, StartTerminalPayment, TerminalPaymentResult, TerminalPaymentStatus } from '../payment-terminal.types';

@Injectable()
export class MockTerminalProvider implements PaymentTerminalProvider {
  private readonly statuses = new Map<string, TerminalPaymentResult>();

  async startPayment(input: StartTerminalPayment): Promise<TerminalPaymentResult> {
    const result: TerminalPaymentResult = {
      status: 'PROCESSING',
      externalReference: input.externalReference,
      provider: 'MOCK',
      terminalId: input.terminalId,
      message: 'Simulation uniquement : aucun terminal ni réseau bancaire contacté.',
    };
    this.statuses.set(input.paymentId, result);
    return result;
  }

  async getPaymentStatus(paymentId: string): Promise<TerminalPaymentResult> {
    return this.statuses.get(paymentId) ?? { status: 'UNKNOWN', provider: 'MOCK', message: 'Statut de simulation inconnu; le paiement reste en attente.' };
  }

  async cancelPayment(paymentId: string): Promise<TerminalPaymentResult> {
    return this.simulate(paymentId, 'CANCELLED');
  }

  simulate(paymentId: string, status: TerminalPaymentStatus): TerminalPaymentResult {
    if (!['APPROVED', 'DECLINED', 'CANCELLED', 'TIMEOUT', 'UNKNOWN'].includes(status)) {
      throw new DomainError('INVALID_MOCK_RESULT', 'Résultat de simulation non pris en charge.', 400);
    }
    const previous = this.statuses.get(paymentId);
    const result: TerminalPaymentResult = {
      status,
      externalReference: previous?.externalReference,
      provider: 'MOCK',
      terminalId: previous?.terminalId ?? process.env.TPE_TERMINAL_ID ?? 'TPE-DEV-01',
      message: status === 'APPROVED' ? 'Paiement simulé accepté.' : status === 'DECLINED' ? 'Paiement simulé refusé.' : status === 'CANCELLED' ? 'Simulation annulée.' : 'Statut indéterminé : vérifiez avant de demander un nouveau paiement.',
    };
    this.statuses.set(paymentId, result);
    return result;
  }
}
