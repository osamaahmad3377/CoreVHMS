import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { clinicAddressSchema, clinicBillingSchema, clinicPlanSchema, createClinicSchema, paymentListSchema, planInputSchema, recordPaymentSchema, voidPaymentSchema, type HostInfo } from '@vcms/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { addressFor, classifyHost, RESERVED_SLUGS } from '../../common/tenancy/hosts';
import { requestHost } from '../../common/tenancy/tenant-resolver.middleware';
import { TenancyService } from '../../common/tenancy/tenancy.service';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { env } from '../../config/env';
import { AttachmentsService } from '../attachments/attachments.service';
import { BrandImage, OrganizationsService, brandingOf } from '../organizations/organizations.service';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformClinicsService } from './platform-clinics.service';
import { PlatformPlansService } from './platform-plans.service';

const suspendSchema = z.object({ reason: z.enum(['UNPAID']).nullish() }).default({});

@ApiTags('platform')
@Controller('platform/clinics')
export class PlatformClinicsController {
  constructor(
    private readonly clinics: PlatformClinicsService,
    private readonly billing: PlatformBillingService,
  ) {}

  @Get()
  @RequirePermissions('platform.clinics.manage')
  list() {
    return this.clinics.list();
  }

  @Get(':id')
  @RequirePermissions('platform.clinics.manage')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinics.get(id);
  }

  @Get(':id/overview')
  @RequirePermissions('platform.clinics.manage')
  overview(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinics.overview(id);
  }

  @Post()
  @RequirePermissions('platform.clinics.manage')
  @ApiZodBody(createClinicSchema)
  create(@Body(zp(createClinicSchema)) body: z.infer<typeof createClinicSchema>) {
    return this.clinics.create(body);
  }

  @Put(':id/plan')
  @RequirePermissions('platform.plans.manage')
  @ApiZodBody(clinicPlanSchema)
  assignPlan(@Param('id', ParseUUIDPipe) id: string, @Body(zp(clinicPlanSchema)) body: z.infer<typeof clinicPlanSchema>) {
    return this.clinics.assignPlan(id, body);
  }

  /** Monthly or yearly billing, and a free trial or free period (then another plan, or paused). */
  @Put(':id/billing')
  @RequirePermissions('platform.plans.manage')
  @ApiZodBody(clinicBillingSchema)
  setBilling(@Param('id', ParseUUIDPipe) id: string, @Body(zp(clinicBillingSchema)) body: z.infer<typeof clinicBillingSchema>) {
    return this.clinics.setBilling(id, body);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequirePermissions('platform.clinics.manage')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinics.retry(id);
  }

  /** Pauses the clinic; `{ reason: 'UNPAID' }` tells its staff the subscription payment is overdue. */
  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions('platform.clinics.manage')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body(zp(suspendSchema)) body: z.infer<typeof suspendSchema>) {
    return this.clinics.suspend(id, body.reason ?? null);
  }

  /** Records what the clinic paid (a month, several months or a year upfront, plus any free months). */
  @Post(':id/payments')
  @RequirePermissions('platform.billing.manage')
  @ApiZodBody(recordPaymentSchema)
  recordPayment(@Param('id', ParseUUIDPipe) id: string, @Body(zp(recordPaymentSchema)) body: z.infer<typeof recordPaymentSchema>) {
    return this.billing.record(id, body);
  }

  /** Emails the owner what is due and by when. */
  @Post(':id/payment-reminder')
  @HttpCode(200)
  @RequirePermissions('platform.billing.manage')
  remind(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.remind(id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermissions('platform.clinics.manage')
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinics.reactivate(id);
  }

  @Post(':id/owner-password')
  @HttpCode(200)
  @RequirePermissions('platform.clinics.manage')
  ownerPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinics.resetOwnerPassword(id);
  }
}

/** Payments clinics made to NextCore, and the money at a glance. */
@ApiTags('platform')
@Controller('platform')
export class PlatformBillingController {
  constructor(private readonly billing: PlatformBillingService) {}

  @Get('payments')
  @RequirePermissions('platform.billing.manage')
  payments(@Query(zp(paymentListSchema)) q: z.infer<typeof paymentListSchema>) {
    return this.billing.list(q);
  }

  /** Cancels a payment recorded by mistake (kept, marked cancelled, with the reason). */
  @Post('payments/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('platform.billing.manage')
  @ApiZodBody(voidPaymentSchema)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(zp(voidPaymentSchema)) body: z.infer<typeof voidPaymentSchema>) {
    return this.billing.void(id, body.reason);
  }

  @Get('billing/summary')
  @RequirePermissions('platform.billing.manage')
  summary() {
    return this.billing.summary();
  }
}

@ApiTags('platform')
@Controller('platform/plans')
export class PlatformPlansController {
  constructor(private readonly plans: PlatformPlansService) {}

  @Get()
  @RequirePermissions('platform.plans.manage')
  list() {
    return this.plans.list();
  }

  @Post()
  @RequirePermissions('platform.plans.manage')
  @ApiZodBody(planInputSchema)
  create(@Body(zp(planInputSchema)) body: z.infer<typeof planInputSchema>) {
    return this.plans.create(body);
  }

  /** Replaces the plans with the recommended Starter, Professional and Premium (clinics move with their plan). */
  @Post('recommended')
  @HttpCode(200)
  @RequirePermissions('platform.plans.manage')
  applyRecommended() {
    return this.plans.applyRecommended();
  }

  @Put(':id')
  @RequirePermissions('platform.plans.manage')
  @ApiZodBody(planInputSchema)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zp(planInputSchema)) body: z.infer<typeof planInputSchema>) {
    return this.plans.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('platform.plans.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.plans.remove(id);
  }
}

/** Clinic owners' requests to change plan, for the super admin to approve or dismiss. */
@ApiTags('platform')
@Controller('platform/plan-requests')
export class PlatformPlanRequestsController {
  constructor(private readonly clinics: PlatformClinicsService) {}

  @Get()
  @RequirePermissions('platform.plans.manage')
  list() {
    return this.clinics.planRequests();
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('platform.plans.manage')
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinics.approvePlanRequest(id);
  }

  @Post(':id/dismiss')
  @HttpCode(204)
  @RequirePermissions('platform.plans.manage')
  async dismiss(@Param('id', ParseUUIDPipe) id: string) {
    await this.clinics.dismissPlanRequest(id);
  }
}

/** Public: lets the sign-in pages show which clinic (or the super admin area) an address belongs to. */
@ApiTags('platform')
@Controller('tenant')
export class HostInfoController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly attachments: AttachmentsService,
  ) {}

  /**
   * The organization whose branding this address shows before sign-in: the clinic's (multi-clinic mode), or
   * the only organization of a single installation. None when an installation holds several organizations.
   */
  private async brandedOrg() {
    const ctx = RequestContext.get();
    if (ctx?.tenant) {
      const t = await this.tenancy.bySlug(ctx.tenant.slug);
      return this.prisma.raw.organization.findFirst({ where: t?.organizationId ? { id: t.organizationId } : {}, orderBy: { createdAt: 'asc' } });
    }
    if (classifyHost(undefined).kind !== 'single') return null;
    const orgs = await this.prisma.raw.organization.findMany({ where: { status: 'ACTIVE' }, take: 2 });
    return orgs.length === 1 ? orgs[0] : null;
  }

  @Public()
  @Get()
  async info(@Req() req: Request): Promise<HostInfo> {
    const host = classifyHost(requestHost(req));
    const baseDomain = env().BASE_DOMAIN;
    if (host.kind === 'single') {
      const org = await this.brandedOrg();
      return org ? { mode: 'single', clinic: { name: org.name, status: 'ACTIVE', branding: brandingOf(org, '/api/v1/tenant') } } : { mode: 'single' };
    }
    if (host.kind === 'platform') return { mode: 'platform', baseDomain };
    if (host.kind === 'tenant') {
      const t = await this.tenancy.bySlug(host.slug);
      const org = t?.status === 'ACTIVE' ? await this.brandedOrg() : null;
      if (t) return { mode: 'clinic', baseDomain, clinic: { name: t.name, status: t.status, ...(org ? { branding: brandingOf(org, '/api/v1/tenant') } : {}) } };
    }
    return { mode: 'root', baseDomain };
  }

  /** The clinic's logo and browser-tab icon, shown on its sign-in page before anyone signs in. */
  @Public()
  @Get('logo')
  logo(@Res() res: Response) {
    return this.sendBrandImage('logo', res);
  }

  @Public()
  @Get('icon')
  icon(@Res() res: Response) {
    return this.sendBrandImage('icon', res);
  }

  @Public()
  @Get('logo-dark')
  logoDark(@Res() res: Response) {
    return this.sendBrandImage('logo-dark', res);
  }

  @Public()
  @Get('login-background')
  loginBackground(@Res() res: Response) {
    return this.sendBrandImage('login-background', res);
  }

  private async sendBrandImage(kind: BrandImage, res: Response) {
    const org = await this.brandedOrg();
    const id = org && this.orgs.brandImageId(org, kind);
    if (!org || !id) throw new NotFoundException({ code: 'NOT_FOUND', message: `No ${kind}` });
    const { meta, stream } = await RequestContext.runAs({ organizationId: org.id }, () => this.attachments.openBrandImage(id));
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }

  /** "Find your clinic": does this address exist? Returns its web address. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('lookup')
  async lookup(@Query('address') address: string): Promise<{ found: boolean; address?: string }> {
    const parsed = clinicAddressSchema.safeParse(address ?? '');
    if (!env().BASE_DOMAIN || !parsed.success || RESERVED_SLUGS.has(parsed.data)) return { found: false };
    const t = await this.tenancy.bySlug(parsed.data);
    return t && t.status !== 'FAILED' ? { found: true, address: addressFor(t.slug) } : { found: false };
  }
}
