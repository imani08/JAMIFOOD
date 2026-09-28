export type TerminalMode = 'MOCK' | 'MANUAL' | 'INTEGRATED';
export type TerminalPaymentStatus = 'PENDING' | 'PROCESSING' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'TIMEOUT' | 'UNKNOWN';

export type StartTerminalPayment = {
  paymentId: string;
  orderId: string;
  amount: string;
  currency: 'CDF' | 'USD';
  terminalId: string;
  externalReference?: string;
};

export type TerminalPaymentResult = {
  status: TerminalPaymentStatus;
  externalReference?: string;
  provider?: string;
  terminalId?: string;
  authorizationCode?: string;
  message?: string;
};

export interface PaymentTerminalProvider {
  startPayment(input: StartTerminalPayment): Promise<TerminalPaymentResult>;
  getPaymentStatus(paymentId: string): Promise<TerminalPaymentResult>;
  cancelPayment(paymentId: string): Promise<TerminalPaymentResult>;
  refundPayment?(paymentId: string, amount: string, currency: 'CDF' | 'USD'): Promise<TerminalPaymentResult>;
}
