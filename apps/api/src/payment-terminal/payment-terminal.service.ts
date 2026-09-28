import { Injectable } from '@nestjs/common';
import { DomainError } from '../http';
import { IntegratedTerminalProvider } from './providers/integrated.provider';
import { ManualTerminalProvider } from './providers/manual.provider';
import { MockTerminalProvider } from './providers/mock.provider';
import type { PaymentTerminalProvider, TerminalMode, TerminalPaymentResult, TerminalPaymentStatus } from './payment-terminal.types';

@Injectable()
export class PaymentTerminalService {
  constructor(private readonly mock: MockTerminalProvider, private readonly manual: ManualTerminalProvider, private readonly integrated: IntegratedTerminalProvider) {}

  get mode(): TerminalMode {
    const value = process.env.TPE_MODE ?? (process.env.NODE_ENV === 'production' ? 'MANUAL' : 'MOCK');
    if (value !== 'MOCK' && value !== 'MANUAL' && value !== 'INTEGRATED') throw new DomainError('INVALID_TPE_MODE', 'TPE_MODE doit valoir MOCK, MANUAL ou INTEGRATED.', 500);
    return value;
  }

  get terminalId(): string { return process.env.TPE_TERMINAL_ID ?? (this.mode === 'MOCK' ? 'TPE-DEV-01' : ''); }
  get providerName(): string { return this.mode === 'MOCK' ? 'MOCK' : this.mode === 'MANUAL' ? 'MANUAL' : process.env.TPE_PROVIDER ?? ''; }
  get isMockEnabled(): boolean { return this.mode === 'MOCK' && process.env.NODE_ENV !== 'production'; }

  private provider(): PaymentTerminalProvider {
    if (this.mode === 'MOCK') {
      if (!this.isMockEnabled) throw new DomainError('MOCK_TPE_DISABLED', 'Le TPE simulé est interdit en production.', 403);
      return this.mock;
    }
    if (this.mode === 'MANUAL') return this.manual;
    if (!process.env.TPE_PROVIDER || !process.env.TPE_TERMINAL_ID || !process.env.TPE_MERCHANT_ID || !process.env.TPE_API_URL || !process.env.TPE_API_KEY) {
      throw new DomainError('TPE_PROVIDER_NOT_CONFIGURED', 'Le mode intégré nécessite un adaptateur fournisseur officiel et sa configuration serveur.', 503);
    }
    return this.integrated;
  }

  assertReady(): void {
    if (this.mode === 'INTEGRATED') throw new DomainError('TPE_ADAPTER_NOT_IMPLEMENTED', 'Le mode intégré est réservé à un adaptateur officiel non encore installé. Aucun paiement n’a été créé.', 503);
    void this.provider();
  }

  startPayment(input: Parameters<PaymentTerminalProvider['startPayment']>[0]): Promise<TerminalPaymentResult> { return this.provider().startPayment(input); }
  getPaymentStatus(paymentId: string): Promise<TerminalPaymentResult> { return this.provider().getPaymentStatus(paymentId); }
  cancelPayment(paymentId: string): Promise<TerminalPaymentResult> { return this.provider().cancelPayment(paymentId); }
  simulate(paymentId: string, status: TerminalPaymentStatus): TerminalPaymentResult {
    if (!this.isMockEnabled) throw new DomainError('MOCK_TPE_DISABLED', 'La simulation est autorisée uniquement en développement/test.', 403);
    return this.mock.simulate(paymentId, status);
  }
  async refundPayment(): Promise<never> { throw new DomainError('TPE_REFUND_UNAVAILABLE', 'Le remboursement bancaire par TPE nécessite un adaptateur officiel; aucun remboursement bancaire n’a été effectué.', 503); }
}
