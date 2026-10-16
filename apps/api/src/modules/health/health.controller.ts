import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Liveness: the process is up and can reach the database. */
  @Public()
  @Get()
  async check() {
    const started = Date.now();
    await this.prisma.raw.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'ok', latencyMs: Date.now() - started, time: new Date().toISOString() };
  }

  /** Readiness: database reachable, no failed migrations, file storage writable. Returns 503 otherwise. */
  @Public()
  @Get('ready')
  async ready() {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.raw.$queryRaw`SELECT 1`;
      checks.database = 'ok';
      const failed = await this.prisma.raw.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
      checks.migrations = Number(failed[0].n) === 0 ? 'ok' : 'unfinished migration';
    } catch {
      checks.database = 'unreachable';
    }
    try {
      await this.storage.probe();
      checks.storage = 'ok';
    } catch {
      checks.storage = 'not writable';
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    if (!ok) throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'Service not ready', details: checks });
    return { status: 'ready', checks, version: process.env.APP_VERSION ?? 'dev' };
  }
}
