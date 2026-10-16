import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ScopedPrismaClient, withTenantScope } from './tenant-extension';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /** Unscoped client. Only for identity/auth, platform jobs and audit writes. */
  readonly raw: PrismaClient;
  /** Tenant-scoped client. Use for all organization data. */
  readonly db: ScopedPrismaClient;

  constructor() {
    this.raw = new PrismaClient({
      // Errors are surfaced through the exception filter; logging them here would duplicate expected 4xx cases.
      log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn'],
    });
    this.db = withTenantScope(this.raw);
  }

  async onModuleInit() {
    await this.raw.$connect();
  }

  async onModuleDestroy() {
    await this.raw.$disconnect();
  }
}
