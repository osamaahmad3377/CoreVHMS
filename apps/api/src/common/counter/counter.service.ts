import { Injectable } from '@nestjs/common';
import { RequestContext } from '../context/request-context';

type RawCapable = { $queryRaw: (query: TemplateStringsArray, ...values: any[]) => PromiseLike<unknown> };

/** Gap-tolerant, concurrency-safe per-organization sequences (row-level lock via upsert). */
@Injectable()
export class CounterService {
  async next(tx: RawCapable, key: string, organizationId = RequestContext.orgId()): Promise<number> {
    const rows = (await tx.$queryRaw`
      INSERT INTO "Counter" ("organizationId", "key", "value")
      VALUES (${organizationId}::uuid, ${key}, 1)
      ON CONFLICT ("organizationId", "key") DO UPDATE SET "value" = "Counter"."value" + 1
      RETURNING "value"`) as { value: number }[];
    return Number(rows[0].value);
  }
}

export const formatNumber = (prefix: string, n: number, width = 6) => `${prefix}-${String(n).padStart(width, '0')}`;
