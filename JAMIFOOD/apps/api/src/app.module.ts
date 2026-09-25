import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { AccessGuard, AuthController, AuthService } from './auth';
import { ClientsController, ClientsService } from './clients';
import { KitchenController, OrdersController, OrdersService } from './orders';
import { MealsController, MealsService } from './meals';
import { CashController } from './cash';
import { StockController } from './stock';
import { SubscriptionsController } from './subscriptions';
import { CatalogController } from './catalog';
import { ApiExceptionFilter } from './http';

@Module({ controllers: [CashController, StockController, SubscriptionsController, CatalogController, KitchenController, HealthController, AuthController, ClientsController, OrdersController, MealsController], providers: [PrismaService, AuthService, ClientsService, OrdersService, MealsService, { provide: APP_GUARD, useClass: AccessGuard }, { provide: APP_FILTER, useClass: ApiExceptionFilter }] })
export class AppModule {}
