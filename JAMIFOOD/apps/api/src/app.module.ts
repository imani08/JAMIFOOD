import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { AuthController, AuthService } from './auth';
import { ClientsController, ClientsService } from './clients';
import { OrdersController, OrdersService } from './orders';
import { MealsController, MealsService } from './meals';
import { ApiExceptionFilter } from './http';

@Module({ controllers: [HealthController, AuthController, ClientsController, OrdersController, MealsController], providers: [PrismaService, AuthService, ClientsService, OrdersService, MealsService, { provide: APP_FILTER, useClass: ApiExceptionFilter }] })
export class AppModule {}
