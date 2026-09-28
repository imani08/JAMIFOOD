import { afterEach, describe, expect, it } from 'vitest';
import { DomainError } from '../http';
import { IntegratedTerminalProvider } from './providers/integrated.provider';
import { ManualTerminalProvider } from './providers/manual.provider';
import { MockTerminalProvider } from './providers/mock.provider';
import { PaymentTerminalService } from './payment-terminal.service';

const originalMode = process.env.TPE_MODE;
const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  if (originalMode === undefined) delete process.env.TPE_MODE; else process.env.TPE_MODE = originalMode;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
});

describe('Payment terminal providers', () => {
  it('keeps mock timeout and unknown states explicitly uncertain', async () => {
    const mock = new MockTerminalProvider();
    const started = await mock.startPayment({ paymentId: 'p1', orderId: 'o1', amount: '15000', currency: 'CDF', terminalId: 'TPE-DEV-01', externalReference: 'MOCK-test' });
    expect(started.status).toBe('PROCESSING');
    for (const status of ['APPROVED', 'DECLINED', 'CANCELLED', 'TIMEOUT', 'UNKNOWN'] as const) {
      expect(mock.simulate('p1', status)).toMatchObject({ status, externalReference: 'MOCK-test', provider: 'MOCK' });
      expect((await mock.getPaymentStatus('p1')).status).toBe(status);
    }
    expect(JSON.stringify(started)).not.toMatch(/pan|cvv|pin|track|emv/i);
  });

  it('does not contact a bank in manual mode and refuses fabricated integration', async () => {
    const manual = new ManualTerminalProvider();
    expect(await manual.startPayment({ paymentId: 'p2', orderId: 'o2', amount: '100', currency: 'USD', terminalId: 'external-tpe', externalReference: 'BANK-REF-1' })).toMatchObject({ status: 'PENDING', externalReference: 'BANK-REF-1' });
    const integrated = new IntegratedTerminalProvider();
    await expect(integrated.startPayment({ paymentId: 'p3', orderId: 'o3', amount: '100', currency: 'USD', terminalId: 'unconfigured' })).rejects.toBeInstanceOf(DomainError);
  });

  it('restricts mock outcomes to development/test and rejects unknown mode values', () => {
    process.env.TPE_MODE = 'MOCK';
    process.env.NODE_ENV = 'production';
    const service = new PaymentTerminalService(new MockTerminalProvider(), new ManualTerminalProvider(), new IntegratedTerminalProvider());
    expect(() => service.simulate('p4', 'APPROVED')).toThrowError(DomainError);
    process.env.TPE_MODE = 'BANK_X';
    expect(() => service.assertReady()).toThrowError(DomainError);
  });
});
