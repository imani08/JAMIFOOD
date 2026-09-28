import { Injectable } from '@nestjs/common';
import type { PaymentTerminalProvider, StartTerminalPayment, TerminalPaymentResult } from '../payment-terminal.types';

@Injectable()
export class ManualTerminalProvider implements PaymentTerminalProvider {
  async startPayment(input: StartTerminalPayment): Promise<TerminalPaymentResult> {
    return { status: 'PENDING', externalReference: input.externalReference, provider: 'MANUAL', terminalId: input.terminalId, message: 'Effectuez le paiement sur le TPE indépendant, puis saisissez sa référence non sensible.' };
  }
  async getPaymentStatus(): Promise<TerminalPaymentResult> {
    return { status: 'UNKNOWN', provider: 'MANUAL', message: 'Le statut doit être vérifié sur le TPE indépendant.' };
  }
  async cancelPayment(): Promise<TerminalPaymentResult> {
    return { status: 'UNKNOWN', provider: 'MANUAL', message: 'Vérifiez le résultat sur le TPE avant toute nouvelle opération.' };
  }
}
