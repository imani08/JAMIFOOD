import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const production = process.env.NODE_ENV === 'production';
  if (production && !process.env.DATABASE_URL) throw new Error('DATABASE_URL est obligatoire en production.');
  const webOrigins = (process.env.WEB_ORIGIN ?? (production ? '' : 'http://localhost:3000,http://localhost:3002'))
    .split(',').map(origin => origin.trim()).filter(Boolean);
  const idleMinutes = Number(process.env.SESSION_IDLE_MINUTES ?? 30);
  if (!Number.isInteger(idleMinutes) || idleMinutes < 5 || idleMinutes > 480) {
    throw new Error('SESSION_IDLE_MINUTES doit être un nombre entier de 5 à 480 minutes.');
  }
  if (production && process.env.COOKIE_SECURE !== 'true') {
    throw new Error('COOKIE_SECURE=true est obligatoire en production.');
  }
  if (production && (!webOrigins.length || webOrigins.some(origin => {
    try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin || origin.includes('*'); }
    catch { return true; }
  }))) {
    throw new Error('WEB_ORIGIN doit contenir une liste explicite d’origines HTTPS en production.');
  }
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.use(helmet());
  app.enableCors({ origin: webOrigins, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  if (!production) {
    const config = new DocumentBuilder().setTitle('JAMI FOOD API').setVersion('1.0').addBearerAuth().build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
  await app.listen(Number(process.env.API_PORT ?? 3001), process.env.API_HOST ?? '127.0.0.1');
  Logger.log('JAMI FOOD API started', 'Bootstrap');
}
void bootstrap();
