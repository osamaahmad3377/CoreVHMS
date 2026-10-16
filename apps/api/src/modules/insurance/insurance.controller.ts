import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  claimDecisionSchema,
  claimPaymentSchema,
  claimSchema,
  insuranceProviderSchema,
  policySchema,
  preAuthDecisionSchema,
  preAuthSchema,
  referralContactSchema,
  referralSchema,
  referralTransitionSchema,
  updateClaimSchema,
  updatePolicySchema,
  updateReferralSchema,
} from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { InsuranceService } from './insurance.service';
import { ReferralsService } from './referrals.service';

const UUID = new ParseUUIDPipe();
const optUuidQ = z.string().uuid().optional();
const listQuery = z.object({ status: z.string().max(200).optional(), patientId: optUuidQ, clientId: optUuidQ, providerId: optUuidQ, policyId: optUuidQ, direction: z.enum(['OUTGOING', 'INCOMING']).optional(), contactId: optUuidQ });

@ApiTags('insurance & referrals')
@Controller()
export class InsuranceController {
  constructor(
    private readonly insurance: InsuranceService,
    private readonly referrals: ReferralsService,
  ) {}

  // ── Insurers ──
  @Get('insurance/providers')
  @RequireAnyPermission('insurance.read', 'billing.read')
  providers(@Query('all') all?: string) {
    return this.insurance.providers(all === 'true');
  }

  @Post('insurance/providers')
  @RequirePermissions('insurance.write')
  @ApiZodBody(insuranceProviderSchema)
  createProvider(@Body(zp(insuranceProviderSchema)) body: z.infer<typeof insuranceProviderSchema>) {
    return this.insurance.createProvider(body);
  }

  @Patch('insurance/providers/:id')
  @RequirePermissions('insurance.write')
  updateProvider(@Param('id', UUID) id: string, @Body(zp(insuranceProviderSchema.partial())) body: Partial<z.infer<typeof insuranceProviderSchema>>) {
    return this.insurance.updateProvider(id, body);
  }

  // ── Policies ──
  @Get('insurance/policies')
  @RequireAnyPermission('insurance.read', 'billing.read')
  policies(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    return this.insurance.policies(q);
  }

  @Post('insurance/policies')
  @RequirePermissions('insurance.write')
  @ApiZodBody(policySchema)
  createPolicy(@Body(zp(policySchema)) body: z.infer<typeof policySchema>) {
    return this.insurance.createPolicy(body);
  }

  @Patch('insurance/policies/:id')
  @RequirePermissions('insurance.write')
  updatePolicy(@Param('id', UUID) id: string, @Body(zp(updatePolicySchema)) body: z.infer<typeof updatePolicySchema>) {
    return this.insurance.updatePolicy(id, body);
  }

  // ── Pre-authorisations ──
  @Get('insurance/pre-authorisations')
  @RequirePermissions('insurance.read')
  preAuths(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    return this.insurance.preAuths(q);
  }

  @Post('insurance/pre-authorisations')
  @RequirePermissions('insurance.write')
  @ApiZodBody(preAuthSchema)
  createPreAuth(@Body(zp(preAuthSchema)) body: z.infer<typeof preAuthSchema>) {
    return this.insurance.createPreAuth(body);
  }

  @Post('insurance/pre-authorisations/:id/submit')
  @HttpCode(200)
  @RequirePermissions('insurance.write')
  submitPreAuth(@Param('id', UUID) id: string) {
    return this.insurance.submitPreAuth(id);
  }

  @Post('insurance/pre-authorisations/:id/decision')
  @HttpCode(200)
  @RequirePermissions('insurance.write')
  decidePreAuth(@Param('id', UUID) id: string, @Body(zp(preAuthDecisionSchema)) body: z.infer<typeof preAuthDecisionSchema>) {
    return this.insurance.decidePreAuth(id, body);
  }

  // ── Claims ──
  @Get('insurance/claims')
  @RequireAnyPermission('insurance.read', 'billing.read')
  claims(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    return this.insurance.claims(q);
  }

  @Post('insurance/claims')
  @RequirePermissions('insurance.write')
  @ApiZodBody(claimSchema)
  createClaim(@Body(zp(claimSchema)) body: z.infer<typeof claimSchema>) {
    return this.insurance.createClaim(body);
  }

  @Get('insurance/claims/:id')
  @RequireAnyPermission('insurance.read', 'billing.read')
  claim(@Param('id', UUID) id: string) {
    return this.insurance.claim(id);
  }

  @Get('insurance/claims/:id/form')
  @RequirePermissions('insurance.read')
  claimForm(@Param('id', UUID) id: string) {
    return this.insurance.claimForm(id);
  }

  @Patch('insurance/claims/:id')
  @RequirePermissions('insurance.write')
  updateClaim(@Param('id', UUID) id: string, @Body(zp(updateClaimSchema)) body: z.infer<typeof updateClaimSchema>) {
    return this.insurance.updateClaim(id, body);
  }

  @Post('insurance/claims/:id/submit')
  @HttpCode(200)
  @RequirePermissions('insurance.write')
  submitClaim(@Param('id', UUID) id: string) {
    return this.insurance.submitClaim(id);
  }

  @Post('insurance/claims/:id/decision')
  @HttpCode(200)
  @RequirePermissions('insurance.write')
  decideClaim(@Param('id', UUID) id: string, @Body(zp(claimDecisionSchema)) body: z.infer<typeof claimDecisionSchema>) {
    return this.insurance.decideClaim(id, body);
  }

  @Post('insurance/claims/:id/payment')
  @HttpCode(200)
  @RequirePermissions('insurance.write', 'payments.take')
  claimPayment(@Param('id', UUID) id: string, @Body(zp(claimPaymentSchema)) body: z.infer<typeof claimPaymentSchema>) {
    return this.insurance.recordPayment(id, body);
  }

  // ── Referrals ──
  @Get('referral-contacts')
  @RequirePermissions('insurance.read')
  contacts(@Query('all') all?: string) {
    return this.referrals.contacts(all === 'true');
  }

  @Post('referral-contacts')
  @RequirePermissions('insurance.write')
  @ApiZodBody(referralContactSchema)
  createContact(@Body(zp(referralContactSchema)) body: z.infer<typeof referralContactSchema>) {
    return this.referrals.createContact(body);
  }

  @Patch('referral-contacts/:id')
  @RequirePermissions('insurance.write')
  updateContact(@Param('id', UUID) id: string, @Body(zp(referralContactSchema.partial())) body: Partial<z.infer<typeof referralContactSchema>>) {
    return this.referrals.updateContact(id, body);
  }

  @Get('referrals')
  @RequirePermissions('insurance.read')
  referralList(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    return this.referrals.list(q);
  }

  @Get('referrals/draft-summary')
  @RequirePermissions('insurance.write', 'clinical.read')
  draftSummary(@Query('patientId', UUID) patientId: string) {
    return this.referrals.draftSummary(patientId);
  }

  @Post('referrals')
  @RequirePermissions('insurance.write')
  @ApiZodBody(referralSchema)
  createReferral(@Body(zp(referralSchema)) body: z.infer<typeof referralSchema>) {
    return this.referrals.create(body);
  }

  @Get('referrals/:id')
  @RequirePermissions('insurance.read')
  referral(@Param('id', UUID) id: string) {
    return this.referrals.get(id);
  }

  @Get('referrals/:id/letter')
  @RequirePermissions('insurance.read', 'clinical.read')
  letter(@Param('id', UUID) id: string) {
    return this.referrals.letter(id);
  }

  @Patch('referrals/:id')
  @RequirePermissions('insurance.write')
  updateReferral(@Param('id', UUID) id: string, @Body(zp(updateReferralSchema)) body: z.infer<typeof updateReferralSchema>) {
    return this.referrals.update(id, body);
  }

  @Post('referrals/:id/transition')
  @HttpCode(200)
  @RequirePermissions('insurance.write')
  transition(@Param('id', UUID) id: string, @Body(zp(referralTransitionSchema)) body: z.infer<typeof referralTransitionSchema>) {
    return this.referrals.transition(id, body);
  }
}
