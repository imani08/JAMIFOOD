import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { Require } from './auth';

describe('explicit route permissions', () => {
  it('accumulates stacked requirements and class requirements', () => {
    @Require('auth.session')
    class Example {
      @Require('orders.cancel')
      @Require('orders.read')
      cancel() { return undefined; }
    }
    const permissions = new Reflector().getAllAndMerge<string[]>('permissions', [Example.prototype.cancel, Example]);
    expect(new Set(permissions)).toEqual(new Set(['auth.session', 'orders.cancel', 'orders.read']));
  });
});
