import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
}

/** Setup checklist for a new practice. Every step is derived from real configuration, never stored flags. */
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async status(): Promise<{ steps: SetupStep[]; completed: number; total: number }> {
    const db = this.prisma.db;
    const org = await this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() } });
    const [staff, hours, types, linkedTypes, services, taxRates, locations, pricedProducts, registers, clients] = await Promise.all([
      db.membership.count({ where: { status: { in: ['ACTIVE', 'INVITED'] } } }),
      db.workingHours.count(),
      db.appointmentType.count({ where: { isActive: true } }),
      db.appointmentType.count({ where: { isActive: true, serviceId: { not: null } } }),
      db.service.count({ where: { isActive: true } }),
      db.taxRate.count({ where: { isActive: true } }),
      db.stockLocation.count({ where: { isActive: true } }),
      db.product.count({ where: { isActive: true, sellPriceMinor: { not: null } } }),
      db.cashRegister.count({ where: { isActive: true } }),
      db.client.count(),
    ]);
    const steps: SetupStep[] = [
      { key: 'profile', title: 'Complete your clinic profile', description: 'Address, phone and tax number appear on invoices and receipts.', href: '/settings/organization', done: !!(org.addressLine1 && org.phone) },
      { key: 'team', title: 'Invite your team', description: 'Add vets, nurses and front-desk staff, each with the role that matches their job.', href: '/settings/staff', done: staff > 1 },
      { key: 'rosters', title: 'Set working hours', description: 'Clinicians can only be booked during their rostered hours.', href: '/staff', done: hours > 0 },
      { key: 'types', title: 'Create appointment types', description: 'For example consultation, vaccination, surgery admission — with their durations.', href: '/settings/appointment-types', done: types > 0 },
      { key: 'services', title: 'Add services, fees and tax rates', description: 'Your price list. Confirm tax rates with your tax adviser.', href: '/settings/services', done: services > 0 && taxRates > 0 },
      { key: 'billing-link', title: 'Link appointment types to services', description: 'Consultations are then billed automatically when they are completed.', href: '/settings/appointment-types', done: linkedTypes > 0 },
      { key: 'products', title: 'Add medicines and products with prices', description: 'Needed for prescribing, dispensing and counter sales.', href: '/pharmacy/formulary', done: pricedProducts > 0 },
      { key: 'stock', title: 'Set up a stock location', description: 'Turns on stock tracking: dispensing and sales deduct stock automatically.', href: '/inventory/locations', done: locations > 0 },
      { key: 'cash', title: 'Add a cash register', description: 'Used to reconcile cash at the end of each day.', href: '/billing/cash', done: registers > 0 },
      { key: 'client', title: 'Register your first client', description: 'Then add their animals and book an appointment.', href: '/clients/new', done: clients > 0 },
    ];
    return { steps, completed: steps.filter((s) => s.done).length, total: steps.length };
  }
}
