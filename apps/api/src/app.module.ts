import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { ProductImagesController } from './product-images';
import { MenusController } from './menus';
import { ClientPhotosController } from './client-photos';
import {
  AccessGuard,
  AuthController,
  AuthService,
} from './auth';
import {
  ClientsController,
  ClientsService,
} from './clients';
import {
  DeliveryController,
  KitchenController,
  OrdersController,
  OrdersService,
} from './orders';
import {
  MealsController,
  MealsService,
} from './meals';
import { CashController } from './cash';
import { StockController } from './stock';
import { SubscriptionsController } from './subscriptions';
import { CatalogController } from './catalog';
import { ApiExceptionFilter } from './http';
import { UsersController } from './users';
import { ClientPortalController, ClientPortalService } from './client-portal';
import { MailService } from './mail.service';

@Module({
  controllers: [
    CashController,
    StockController,
    SubscriptionsController,
    CatalogController,
    KitchenController,
    HealthController,
    AuthController,
    ClientsController,
    OrdersController,
    MealsController,
    UsersController,
    ProductImagesController,
    MenusController,
    ClientPhotosController,
    DeliveryController,
    ClientPortalController,
  ],
  providers: [
    PrismaService,
    AuthService,
    ClientsService,
    OrdersService,
    MealsService,
    ClientPortalService,
    MailService,
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
