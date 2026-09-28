import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { ProductImagesController } from './product-images';
import { MenusController } from './menus';
import {
  AccessGuard,
  AuthController,
  AuthService,
} from './auth';
import {
  ClientsController,
  ClientsService,
} from './clients';
import { OrdersController, OrdersService } from './orders';
import { CashController } from './cash';
import { StockController } from './stock';
import { SubscriptionsController } from './subscriptions';
import { CatalogController } from './catalog';
import { ApiExceptionFilter } from './http';
import { UsersController } from './users';
import { PaymentTerminalService } from './payment-terminal/payment-terminal.service';
import { MockTerminalProvider } from './payment-terminal/providers/mock.provider';
import { ManualTerminalProvider } from './payment-terminal/providers/manual.provider';
import { IntegratedTerminalProvider } from './payment-terminal/providers/integrated.provider';

@Module({
  controllers: [
    CashController,
    StockController,
    SubscriptionsController,
    CatalogController,
    HealthController,
    AuthController,
    ClientsController,
    OrdersController,
    UsersController,
    ProductImagesController,
    MenusController,
  ],
  providers: [
    PrismaService,
    AuthService,
    ClientsService,
    OrdersService,
    PaymentTerminalService,
    MockTerminalProvider,
    ManualTerminalProvider,
    IntegratedTerminalProvider,
    {
      provide: APP_GUARD,
      useClass: AccessGuard,
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule {}
