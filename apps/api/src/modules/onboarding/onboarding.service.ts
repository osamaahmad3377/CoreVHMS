import { Injectable } from '@nestjs/common';
import { OPTIONAL_MODULES, enabledModules, type OptionalModule } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
  skipped: boolean;
  /** Something the server does when the owner presses Start, before opening `href`. */
  startAction?: 'store-room';
}

export const SETUP_STEP_KEYS = ['profile', 'modules', 'prices', 'tax', 'staff', 'rosters', 'products', 'stock', 'receipt', 'cash', 'first-client'] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

export const STORE_ROOM_NAME = 'Main store';

/**
 * Setup checklist for a new clinic. "Done" is always derived from real configuration; only the owner's
 * choices (skip a step, hide the checklist, first save of "Services you offer") are stored on the organization.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private org() {
    return this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
  }

  async status(): Promise<{ steps: SetupStep[]; completed: number; total: number; hidden: boolean; minutes: number }> {
    const db = this.prisma.db;
    const org = await this.org();
    const [staff, hours, services, unpriced, taxRates, pricedProducts, stockMoves, receipt, cashSessions, clients, appointments] = await Promise.all([
      db.membership.count({ where: { status: { in: ['ACTIVE', 'INVITED'] } } }),
      db.workingHours.count(),
      db.service.count({ where: { isActive: true } }),
      db.service.count({ where: { isActive: true, priceMinor: 0 } }),
      db.taxRate.count({ where: { isActive: true } }),
      db.product.count({ where: { isActive: true, sellPriceMinor: { not: null } } }),
      db.stockMovement.count(),
      db.receiptSettings.count(),
      db.cashSession.count(),
      db.client.count(),
      db.appointment.count(),
    ]);
    const skipped = new Set(org.setupSkipped);
    const step = (key: SetupStepKey, title: string, description: string, href: string, done: boolean, startAction?: SetupStep['startAction']): SetupStep => ({
      key,
      title,
      description,
      href,
      done,
      skipped: !done && skipped.has(key),
      ...(startAction ? { startAction } : {}),
    });
    const steps: SetupStep[] = [
      step('profile', 'Add your clinic details', 'Your address and phone number. They are printed on every invoice and receipt.', '/settings/organization', !!(org.addressLine1 && org.phone)),
      step('modules', 'Choose what you offer', 'Switch off what you don’t do, like hospital or boarding, so the menus stay short.', '/settings/modules', !!org.modulesChosenAt),
      step(
        'prices',
        'Check your price list',
        unpriced ? `We added common services with no price. Enter your own price for ${unpriced === 1 ? 'the last one' : `all ${unpriced}`}.` : 'Add the services you charge for, with their prices.',
        '/settings/services',
        services > 0 && unpriced === 0,
      ),
      step('tax', 'Choose your tax setting', 'Add the sales tax you charge, or a 0% rate if you don’t charge tax.', '/settings/billing', taxRates > 0),
      step('staff', 'Add your staff', 'Give each vet, nurse and receptionist their own login.', '/settings/staff', staff > 1),
      step('rosters', 'Set staff working days', 'Choose the days and hours each vet works. Appointments can only be booked in these hours.', '/staff', hours > 0),
      step('products', 'Add products you sell', 'Medicines, vaccines, pet food and accessories, with their selling price.', '/inventory/catalog?new=1', pricedProducts > 0),
      step('stock', 'Enter the stock you have now', 'Count what is on your shelves and enter it. Stock then goes down by itself when you sell or dispense.', '/inventory?receive=1', stockMoves > 0, 'store-room'),
      step('receipt', 'Set up your receipt', 'Choose the paper size and the message printed at the bottom of each receipt.', '/settings/receipts', receipt > 0),
      step('cash', 'Set up your cash drawer', 'Count the cash in the drawer and open it, so each day’s cash adds up.', '/billing/cash', cashSessions > 0),
      step('first-client', 'Add your first client and book an appointment', 'Add a pet owner and their animal, then book them in on the calendar.', clients ? '/calendar' : '/clients/new', clients > 0 && appointments > 0),
    ];
    return { steps, completed: steps.filter((s) => s.done).length, total: steps.length, hidden: !!org.setupHiddenAt, minutes: 20 };
  }

  /** "Skip for now": the step stays in the list, marked as skipped, and the next step becomes current. */
  async skip(key: string) {
    if (!(SETUP_STEP_KEYS as readonly string[]).includes(key)) throw notFound('Setup step');
    const id = RequestContext.orgId();
    await this.prisma.raw.$transaction(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id } });
      if (org.setupSkipped.includes(key)) return;
      await tx.organization.update({ where: { id }, data: { setupSkipped: [...org.setupSkipped, key] } });
      await this.audit.record({ action: 'setup.step_skipped', entityType: 'Organization', entityId: id, summary: key }, tx);
    });
    return this.status();
  }

  /** Hides the checklist for everyone in the clinic until "Show setup again". */
  async hide() {
    const id = RequestContext.orgId();
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.organization.update({ where: { id }, data: { setupHiddenAt: new Date() } });
      await this.audit.record({ action: 'setup.hidden', entityType: 'Organization', entityId: id }, tx);
    });
    return this.status();
  }

  /** "Show setup again": un-hides the checklist and brings back skipped steps. */
  async show() {
    const id = RequestContext.orgId();
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.organization.update({ where: { id }, data: { setupHiddenAt: null, setupSkipped: [] } });
      await this.audit.record({ action: 'setup.shown', entityType: 'Organization', entityId: id }, tx);
    });
    return this.status();
  }

  /**
   * Creates the "Main store" stock location in the current branch if the branch has none, so stock can be
   * received. Done on demand rather than at registration: any stock location switches stock checks on.
   */
  async ensureStoreRoom() {
    const ctx = RequestContext.require();
    const branchId = ctx.branchId;
    if (!branchId) throw ruleViolation('NO_BRANCH', 'Choose a branch first');
    return this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.stockLocation.findFirst({ where: { branchId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
      if (existing) return { location: existing, created: false };
      const location = await tx.stockLocation.create({ data: { organizationId: RequestContext.orgId(), branchId, name: STORE_ROOM_NAME, type: 'STORE', isDefault: true } });
      await this.audit.record({ action: 'stock_location.created', entityType: 'StockLocation', entityId: location.id, summary: `${location.name} (from the setup checklist)` }, tx);
      return { location, created: true };
    });
  }

  // ── Services you offer ──

  async modules() {
    const org = await this.org();
    return { enabled: enabledModules(org.disabledModules), available: [...OPTIONAL_MODULES], chosenAt: org.modulesChosenAt };
  }

  /** Switching a module off only hides it (menus, shortcuts, dashboard panels); no data is changed or deleted. */
  async setModules(enabled: OptionalModule[]) {
    const id = RequestContext.orgId();
    const on = new Set(enabled);
    const disabled = OPTIONAL_MODULES.filter((m) => !on.has(m));
    await this.prisma.raw.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id } });
      const was = enabledModules(before.disabledModules);
      // Keep any unknown (future or retired) keys the clinic switched off.
      const keep = before.disabledModules.filter((m) => !(OPTIONAL_MODULES as readonly string[]).includes(m));
      await tx.organization.update({ where: { id }, data: { disabledModules: [...keep, ...disabled], modulesChosenAt: before.modulesChosenAt ?? new Date() } });
      const turnedOn = OPTIONAL_MODULES.filter((m) => on.has(m) && !was.includes(m));
      const turnedOff = OPTIONAL_MODULES.filter((m) => !on.has(m) && was.includes(m));
      await this.audit.record(
        {
          action: 'organization.modules_updated',
          entityType: 'Organization',
          entityId: id,
          summary: [turnedOn.length && `Turned on: ${turnedOn.join(', ')}`, turnedOff.length && `Turned off: ${turnedOff.join(', ')}`].filter(Boolean).join('. ') || 'No change',
          changes: { enabledModules: { from: was, to: OPTIONAL_MODULES.filter((m) => on.has(m)) } },
        },
        tx,
      );
    });
    return this.modules();
  }
}
