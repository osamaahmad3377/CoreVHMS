import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { requestContextMiddleware } from './common/context/request-context.middleware';
import { AllExceptionsFilter } from './common/http/exception.filter';
import { requestLoggerMiddleware } from './common/logging/request-logger.middleware';
import { TenancyService } from './common/tenancy/tenancy.service';
import { tenantResolverMiddleware } from './common/tenancy/tenant-resolver.middleware';
import { env } from './config/env';

/** Shared HTTP configuration for the server and integration tests. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  const trust = env().TRUST_PROXY;
  express.set('trust proxy', trust === 'false' ? false : /^\d+$/.test(trust) ? Number(trust) : trust);
  express.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: env().NODE_ENV === 'production' ? undefined : false }));
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.use(tenantResolverMiddleware(app.get(TenancyService)));
  if (env().LOG_REQUESTS) app.use(requestLoggerMiddleware);
  express.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (env().NODE_ENV !== 'test' && env().API_DOCS) {
    const config = new DocumentBuilder()
      .setTitle('NextCore VCMS API')
      .setDescription('Veterinary Clinic Management System REST API (v1). Authentication uses an HttpOnly session cookie plus an X-CSRF-Token header for state-changing requests.')
      .setVersion('1.0')
      .addCookieAuth('vcms_sid')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
  return app;
}
