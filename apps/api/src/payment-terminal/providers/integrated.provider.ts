import { Injectable } from '@nestjs/common';
import { DomainError } from '../../http';
import type { PaymentTerminalProvider, StartTerminalPayment, TerminalPaymentResult } from '../payment-terminal.types';

@Injectable()
export class IntegratedTerminalProvider implements PaymentTerminalProvider {
  async startPayment(_input: StartTerminalPayment): Promise<TerminalPaymentResult> { throw new DomainError('TPE_PROVIDER_NOT_CONFIGURED', 'Aucun adaptateur fournisseur de TPE intégré n’est configuré. Aucun paiement n’a été lancé.', 503); }
  async getPaymentStatus(_paymentId: string): Promise<TerminalPaymentResult> { throw new DomainError('TPE_PROVIDER_NOT_CONFIGURED', 'Le statut du TPE ne peut pas être interrogé sans adaptateur fournisseur officiel.', 503); }
  async cancelPayment(_paymentId: string): Promise<TerminalPaymentResult> { throw new DomainError('TPE_PROVIDER_NOT_CONFIGURED', 'L’annulation TPE intégrée n’est pas disponible sans adaptateur fournisseur officiel.', 503); }
}
