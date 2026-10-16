import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { reportQuery } from '@vcms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { notFound } from '../../common/http/errors';
import { ApiZodQuery, zp } from '../../common/http/zod';
import { ReportsService } from './reports.service';

type Q = z.infer<typeof reportQuery>;

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  private async send(res: Response, q: Q, name: string, data: unknown, rows?: Record<string, unknown>[]) {
    if (q.format === 'csv') {
      const out = rows ?? (Array.isArray(data) ? data : [data as Record<string, unknown>]);
      // Downloads leave the system (some reports list clients), so each one is audited.
      await this.audit.record({ action: 'report.exported', entityType: 'Organization', entityId: RequestContext.orgId(), summary: `${name} ${q.from.toISOString().slice(0, 10)} – ${q.to.toISOString().slice(0, 10)}, ${out.length} rows` });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}-${q.from.toISOString().slice(0, 10)}-${q.to.toISOString().slice(0, 10)}.csv"`);
      res.send(this.reports.toCsv(out));
      return;
    }
    res.json(data);
  }

  @Get('financial-summary')
  @RequirePermissions('reports.financial')
  @ApiZodQuery(reportQuery)
  async summary(@Query(zp(reportQuery)) q: Q, @Res() res: Response) {
    const data = await this.reports.financialSummary(q.from, q.to, q.branchId);
    // The CSV is a single summary row; the nested breakdowns stay in the JSON response.
    const { paymentsByMethod: _byMethod, expensesByCategory: _byCategory, period, ...flat } = data;
    return this.send(res, q, 'financial-summary', data, [{ ...flat, from: period.from, to: period.to }]);
  }

  @Get(':name')
  @RequireAnyPermission('reports.view', 'reports.financial')
  @ApiZodQuery(reportQuery)
  async named(@Param('name') name: string, @Query(zp(reportQuery)) q: Q, @Res() res: Response) {
    switch (name) {
      case 'sales-by-item': {
        const rows = await this.reports.salesByItem(q.from, q.to, q.branchId);
        return this.send(res, q, name, rows);
      }
      case 'aged-receivables': {
        const d = await this.reports.agedReceivables(q.branchId);
        return this.send(res, q, name, d, d.invoices.map((i) => ({ ...i, client: i.client?.displayName })));
      }
      case 'stock-valuation': {
        const d = await this.reports.stockValuation();
        return this.send(res, q, name, d, d.rows);
      }
      case 'write-offs': {
        const d = await this.reports.writeOffs(q.from, q.to);
        return this.send(res, q, name, d, d.rows.map((r) => ({ date: r.createdAt, product: r.product.name, batch: r.batch.batchNumber, quantity: r.quantity, reason: r.reason, costMinor: r.costMinor })));
      }
      case 'appointments': {
        const d = await this.reports.appointmentStats(q.from, q.to, q.branchId);
        return this.send(res, q, name, d, [{ total: d.total, ...d.byStatus, noShowRate: d.noShowRate, cancellationRate: d.cancellationRate }]);
      }
      case 'clinical-activity': {
        const d = await this.reports.clinicalActivity(q.from, q.to, q.branchId);
        const row = (section: string, item: string, count: number | null, extra = '') => ({ section, item, count, detail: extra });
        return this.send(res, q, name, d, [
          row('Consultations', 'Total', d.consultations.total, `${d.consultations.completed} completed`),
          ...d.consultations.byClinician.map((r) => row('Consultations by clinician', r.clinician, r.count)),
          ...d.consultations.bySpecies.map((r) => row('Consultations by species', r.species, r.count)),
          ...d.diagnoses.map((r) => row('Diagnoses (top 15)', r.diagnosis, r.count, `${r.confirmed} confirmed`)),
          row('Hospital', 'Admitted', d.hospital.admitted),
          row('Hospital', 'Discharged', d.hospital.discharged, d.hospital.averageStayDays === null ? '' : `average stay ${d.hospital.averageStayDays} days`),
          ...d.hospital.outcomes.map((r) => row('Hospital outcomes', r.outcome, r.count)),
          row('Surgery', 'Completed', d.surgery.completed, `${d.surgery.withComplications} with complications recorded`),
          ...d.surgery.byProcedure.map((r) => row('Surgery by procedure (top 10)', r.procedure, r.count)),
          row('New patients', 'Total (all branches)', d.newPatients.total),
          ...d.newPatients.bySpecies.map((r) => row('New patients by species', r.species, r.count)),
        ]);
      }
      default:
        throw notFound('Report');
    }
  }
}
