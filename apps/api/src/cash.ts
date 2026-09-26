import { Body, Controller, Get, Headers, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from './transport';
import { Prisma } from '@jami/database';
import { money, uuid, currency } from '@jami/validation';
import { z } from 'zod';
import { AuthRequest, Require } from './auth';
import { PrismaService } from './prisma.service';
import { audit, lockCash, mutate } from './transaction';
import { DomainError } from './http';

@Controller('cash')
export class CashController {
  constructor(private readonly db: PrismaService) {}

  @Require('cash.read')
  @Get()
  async current(@Req() req: AuthRequest) {
    return {
      success: true,
      data: await this.db.cashSession.findFirst({
        where: {
          cashierId: req.actor.id,
          status: { in: ['OPEN', 'COUNTING'] },
        },
        select: {
          id: true,
          openedAt: true,
          status: true,
          cashRegister: true,
        },
      }),
    };
  }

  @Require('cash.open')
  @Get('registers')
  async registers() {
    return {
      success: true,
      data: await this.db.cashRegister.findMany({
        where: { active: true },
      }),
    };
  }

  @Require('cash.open')
  @Post('open')
  open(
    @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const body = z
      .object({
        cashRegisterId: uuid,
        openingUsd: money,
        openingCdf: money,
      })
      .strict()
      .parse(input);

    return mutate(
      this.db,
      'cash.open',
      key,
      req.actor.id,
      body,
      async (tx) => {
        await tx.$queryRaw`
          SELECT id
          FROM "CashRegister"
          WHERE id = ${body.cashRegisterId}::uuid
          FOR UPDATE
        `;

        if (
          !(await tx.cashRegister.findFirst({
            where: {
              id: body.cashRegisterId,
              active: true,
            },
          }))
        ) {
          throw new DomainError(
            'NOT_FOUND',
            'Caisse introuvable.',
            404,
          );
        }

        if (
          await tx.cashSession.findFirst({
            where: {
              OR: [
                { cashRegisterId: body.cashRegisterId },
                { cashierId: req.actor.id },
              ],
              status: { in: ['OPEN', 'COUNTING'] },
            },
          })
        ) {
          throw new DomainError(
            'CASH_ALREADY_OPEN',
            'Une session est déjà ouverte pour cette caisse ou cet agent.',
          );
        }

        const session = await tx.cashSession.create({
          data: { ...body, cashierId: req.actor.id },
        });

        await audit(
          tx,
          req.actor.id,
          'CASH_OPENED',
          'CashSession',
          session.id,
        );

        return { id: session.id, status: session.status };
      },
    ).then((data) => ({ success: true, data }));
  }

  @Require('cash.expense')
  @Get('expense-categories')
  async categories() {
    return {
      success: true,
      data: await this.db.expenseCategory.findMany(),
    };
  }

  @Require('cash.expense')
  @Post('expenses')
  expense(
    @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const body = z
      .object({
        cashSessionId: uuid,
        categoryId: uuid,
        beneficiary: z.string().min(2).max(150),
        reason: z.string().min(5).max(500),
        amount: money,
        currency,
      })
      .strict()
      .parse(input);

    return mutate(
      this.db,
      'cash.expense',
      key,
      req.actor.id,
      body,
      async (tx) => {
        const session = await lockCash(
          tx,
          body.cashSessionId,
          req.actor.id,
        );

        if (new Prisma.Decimal(body.amount).lte(0)) {
          throw new DomainError(
            'INVALID_AMOUNT',
            'Montant positif requis.',
            400,
          );
        }

        const moves = await tx.cashMovement.findMany({
          where: {
            cashSessionId: session.id,
            currency: body.currency,
          },
        });

        const available = moves.reduce(
          (total, movement) =>
            movement.type === 'CASH_IN'
              ? total.add(movement.amount)
              : movement.type === 'CASH_OUT'
                ? total.sub(movement.amount)
                : total,
          body.currency === 'USD'
            ? session.openingUsd
            : session.openingCdf,
        );

        if (available.lt(body.amount)) {
          throw new DomainError(
            'INSUFFICIENT_CASH',
            'Fonds de caisse insuffisant.',
          );
        }

        const expense = await tx.expense.create({
          data: {
            ...body,
            paymentMethod: 'CASH',
            createdById: req.actor.id,
            authorizedById: req.actor.id,
          },
        });

        await tx.cashMovement.create({
          data: {
            cashSessionId: session.id,
            type: 'CASH_OUT',
            amount: body.amount,
            currency: body.currency,
            sourceType: 'EXPENSE',
            sourceId: expense.id,
          },
        });

        await audit(
          tx,
          req.actor.id,
          'EXPENSE_CREATED',
          'Expense',
          expense.id,
          { receiptMissing: true },
        );

        return expense;
      },
    ).then((data) => ({ success: true, data }));
  }

  @Require('cash.close')
  @Post(':id/close')
  close(
    @Param('id') id: string,
    @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    const body = z
      .object({
        countedUsd: money,
        countedCdf: money,
        reason: z.string().max(500),
      })
      .strict()
      .parse(input);

    return mutate(
      this.db,
      'cash.close',
      key,
      req.actor.id,
      { id, ...body },
      async (tx) => {
        const session = await lockCash(
          tx,
          id,
          req.actor.id,
        );

        if (
          await tx.payment.count({
            where: {
              cashSessionId: id,
              status: 'PENDING',
            },
          })
        ) {
          throw new DomainError(
            'PENDING_PAYMENTS',
            'Rapprochez les paiements en attente avant clôture.',
          );
        }

        const moves = await tx.cashMovement.findMany({
          where: { cashSessionId: id },
        });

        const totals = {
          USD: session.openingUsd,
          CDF: session.openingCdf,
        };

        const digital = {
          USD: new Prisma.Decimal(0),
          CDF: new Prisma.Decimal(0),
        };

        const sales = {
          USD: new Prisma.Decimal(0),
          CDF: new Prisma.Decimal(0),
        };

        const refunds = {
          USD: new Prisma.Decimal(0),
          CDF: new Prisma.Decimal(0),
        };

        const expenses = {
          USD: new Prisma.Decimal(0),
          CDF: new Prisma.Decimal(0),
        };

        for (const m of moves) {
          if (m.type === 'CASH_IN') {
            totals[m.currency] = totals[m.currency].add(m.amount);
          }

          if (m.type === 'CASH_OUT') {
            totals[m.currency] = totals[m.currency].sub(m.amount);
          }

          if (m.type === 'DIGITAL_IN') {
            digital[m.currency] = digital[m.currency].add(m.amount);
          }

          if (
            m.sourceType === 'PAYMENT' &&
            m.type === 'CASH_IN'
          ) {
            sales[m.currency] = sales[m.currency].add(m.amount);
          }

          if (m.sourceType === 'REFUND') {
            refunds[m.currency] = refunds[m.currency].add(m.amount);
          }

          if (m.sourceType === 'EXPENSE') {
            expenses[m.currency] = expenses[m.currency].add(m.amount);
          }
        }

        const variance = {
          USD: new Prisma.Decimal(body.countedUsd).sub(totals.USD),
          CDF: new Prisma.Decimal(body.countedCdf).sub(totals.CDF),
        };

        if (
          (!variance.USD.eq(0) || !variance.CDF.eq(0)) &&
          body.reason.trim().length < 5
        ) {
          throw new DomainError(
            'VARIANCE_REASON_REQUIRED',
            'Un écart exige une justification.',
          );
        }

        const closing = await tx.cashClosing.create({
          data: {
            cashSessionId: id,
            countedUsd: body.countedUsd,
            countedCdf: body.countedCdf,
            status: 'SUBMITTED',
            theoreticalSnapshot: {
              USD: totals.USD.toString(),
              CDF: totals.CDF.toString(),
              salesUsd: sales.USD.toString(),
              salesCdf: sales.CDF.toString(),
              refundsUsd: refunds.USD.toString(),
              refundsCdf: refunds.CDF.toString(),
              expensesUsd: expenses.USD.toString(),
              expensesCdf: expenses.CDF.toString(),
              digitalUSD: digital.USD.toString(),
              digitalCDF: digital.CDF.toString(),
            },
            varianceSnapshot: {
              USD: variance.USD.toString(),
              CDF: variance.CDF.toString(),
              reason: body.reason,
            },
          },
        });

        await tx.cashSession.update({
          where: { id },
          data: {
            status: 'CLOSED',
            closedAt: new Date(),
          },
        });

        await audit(
          tx,
          req.actor.id,
          'CASH_CLOSED',
          'CashClosing',
          closing.id,
        );

        return closing;
      },
    ).then((data) => ({ success: true, data }));
  }

  @Require('cash.read')
  @Get('closings')
  async closings() {
    return {
      success: true,
      data: await this.db.cashClosing.findMany({
        take: 100,
        orderBy: { submittedAt: 'desc' },
      }),
    };
  }

  @Require('reports.export')
  @Get('closings/:id/export')
  async exportClosing(
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    uuid.parse(id);

    const c = await this.db.cashClosing.findUniqueOrThrow({
      where: { id },
    });

    const totals = c.theoreticalSnapshot as Record<string, string>;
    const variance = c.varianceSnapshot as Record<string, string>;

    const rows = [
      ['JAMI FOOD', 'Rapport de clôture'],
      ['Session', c.cashSessionId],
      ['Statut', c.status],
      ['Date', c.submittedAt.toISOString()],
      [],
      ['Nature', 'USD', 'CDF'],
      ['Ventes espèces', totals.salesUsd ?? '0', totals.salesCdf ?? '0'],
      ['Remboursements', totals.refundsUsd ?? '0', totals.refundsCdf ?? '0'],
      ['Dépenses', totals.expensesUsd ?? '0', totals.expensesCdf ?? '0'],
      ['Paiements numériques', totals.digitalUSD ?? '0', totals.digitalCDF ?? '0'],
      [],
      ['Devise', 'Théorique', 'Physique', 'Écart'],
      ['USD', totals.USD, c.countedUsd.toString(), variance.USD],
      ['CDF', totals.CDF, c.countedCdf.toString(), variance.CDF],
      [],
      ['Justification écart', variance.reason ?? ''],
    ];

    const csv =
      '\ufeff' +
      rows
        .map((row) =>
          row
            .map(
              (value) =>
                '"' +
                String(value ?? '')
                  .replace(/^[=+@-]/, "'$&")
                  .replaceAll('"', '""') +
                '"',
            )
            .join(';'),
        )
        .join('\r\n');

    response.setHeader(
      'Content-Type',
      'text/csv; charset=utf-8',
    );

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="cloture-${id}.csv"`,
    );

    response.send(csv);
  }

  @Require('cash.validate')
  @Post('closings/:id/validate')
  validate(
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    return mutate(
      this.db,
      'cash.validate',
      key,
      req.actor.id,
      { id },
      async (tx) => {
        const result = await tx.cashClosing.updateMany({
          where: {
            id,
            status: 'SUBMITTED',
          },
          data: {
            status: 'VALIDATED',
            validatedAt: new Date(),
            validatedById: req.actor.id,
          },
        });

        if (result.count !== 1) {
          throw new DomainError(
            'CLOSING_IMMUTABLE',
            'Clôture déjà validée ou introuvable.',
          );
        }

        await audit(
          tx,
          req.actor.id,
          'CASH_VALIDATED',
          'CashClosing',
          id,
        );

        return { id, status: 'VALIDATED' };
      },
    ).then((data) => ({ success: true, data }));
  }
}
