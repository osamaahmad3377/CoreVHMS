import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_DIARY_SETTINGS, diarySettingsSchema, type DiarySettings } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';

/** How the clinic's pet diary looks (Settings → Pet diary). A clinic that has changed nothing gets the defaults. */
@Injectable()
export class DiarySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The saved design, with anything missing (or no longer valid) filled in from the defaults. */
  async get(): Promise<DiarySettings> {
    const row = await this.prisma.db.diarySettings.findFirst();
    if (!row) return DEFAULT_DIARY_SETTINGS;
    const parsed = diarySettingsSchema.safeParse(row.config);
    return parsed.success ? parsed.data : DEFAULT_DIARY_SETTINGS;
  }

  async update(input: DiarySettings): Promise<DiarySettings> {
    const ctx = RequestContext.require();
    const config = input as unknown as Prisma.InputJsonValue;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.diarySettings.upsert({
        where: { organizationId: ctx.organizationId! },
        create: { organizationId: ctx.organizationId!, config, updatedByName: ctx.userName ?? null },
        update: { config, updatedByName: ctx.userName ?? null },
      });
      await this.audit.record({ action: 'diary_settings.updated', entityType: 'Organization', entityId: ctx.organizationId!, summary: `Pet diary design: ${input.theme.toLowerCase()}, “${input.title}”` }, tx);
    });
    return this.get();
  }

  /** Back to the standard design. */
  async reset(): Promise<DiarySettings> {
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.diarySettings.deleteMany({});
      await this.audit.record({ action: 'diary_settings.reset', entityType: 'Organization', entityId: ctx.organizationId!, summary: 'Pet diary design reset to standard' }, tx);
    });
    return DEFAULT_DIARY_SETTINGS;
  }
}
