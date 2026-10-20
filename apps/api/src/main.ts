import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { env } from './config/env';
import { JsonLogger } from './common/logging/json-logger';
// test changes
async function bootstrap() {
  const config = env(); // fail fast on invalid configuration
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: config.LOG_FORMAT === 'json' ? new JsonLogger() : undefined });
  configureApp(app);
  await app.listen(config.PORT);
  new Logger('Bootstrap').log(`API listening on http://localhost:${config.PORT}/api/v1 (docs: /api/docs)`);
}

void bootstrap();
