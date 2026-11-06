import { Injectable } from '@nestjs/common';
import { AUTOMATION_RECIPES, type AutomationInput } from '@vcms/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AutomationsService } from '../automations/automations.service';

/** The ready-made automations that send the owner their links. */
export const SHARING_AUTOMATIONS = {
  diary: { recipeKey: 'diary-after-visit', label: 'Send the pet diary link after each visit' },
  certificate: { recipeKey: 'certificate-issued', label: 'Send the certificate link when a certificate is issued' },
} as const;
export type SharingAutomation = keyof typeof SHARING_AUTOMATIONS;

/**
 * Switches the “send the link automatically” automations on or off from Settings → Pet diary. They are ordinary
 * automations (visible and editable under Settings → Automations), made from ready-made recipes.
 */
@Injectable()
export class DiaryAutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automations: AutomationsService,
  ) {}

  async state() {
    const rows = await this.prisma.db.automation.findMany({ where: { recipeKey: { in: Object.values(SHARING_AUTOMATIONS).map((a) => a.recipeKey) } }, select: { id: true, recipeKey: true, isActive: true } });
    return Object.fromEntries(
      (Object.keys(SHARING_AUTOMATIONS) as SharingAutomation[]).map((k) => {
        const r = rows.find((x) => x.recipeKey === SHARING_AUTOMATIONS[k].recipeKey);
        return [k, { label: SHARING_AUTOMATIONS[k].label, exists: !!r, on: !!r?.isActive }];
      }),
    ) as Record<SharingAutomation, { label: string; exists: boolean; on: boolean }>;
  }

  async set(which: SharingAutomation, on: boolean) {
    const key = SHARING_AUTOMATIONS[which].recipeKey;
    const have = await this.prisma.db.automation.findFirst({ where: { recipeKey: key } });
    if (have) {
      if (have.isActive !== on) await this.automations.setActive(have.id, on);
    } else if (on) {
      const recipe = AUTOMATION_RECIPES.find((r) => r.key === key)!;
      await this.automations.create({ ...recipe.automation, isActive: true, recipeKey: key } as AutomationInput);
    }
    return this.state();
  }
}
