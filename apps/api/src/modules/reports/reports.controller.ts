import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { formatInTimeZone } from 'date-fns-tz';
import { ApiTags } from '@nestjs/swagger';
import { enumLabel, reportQuery } from '@vcms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { notFound } from '../../common/http/errors';
import { ApiZodQuery, zp } from '../../common/http/zod';
import { csvRow } from '../../common/util/csv';
import { ReportsService } from './reports.service';

type Q = z.infer<typeof reportQuery>;
type Col = { key: string; header: string; money?: boolean; percent?: boolean; date?: 'date' | 'datetime' };
const SALES_COLS: Col[] = [
  { key: 'netMinor', header: 'Net sales', money: true },
  { key: 'taxMinor', header: 'Tax', money: true },
  { key: 'grossMinor', header: 'Total incl. tax', money: true },
];

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * JSON for the screen; for CSV a spreadsheet-ready table: named columns, money in major units (1,500.00 not 150000),
   * dates in the branch's timezone, and the header row even when the period has no data.
   */
  private async send(res: Response, q: Q, name: string, data: unknown, rows: Record<string, unknown>[] = [], columns: Col[] = []) {
    if (q.format !== 'csv') {
      res.json(data);
      return;
    }
    const [{ currency }, tz] = await Promise.all([this.reports.currency(), this.reports.timezone(q.branchId)]);
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const day = (d: Date) => formatInTimeZone(d, tz, 'yyyy-MM-dd');
    const cell = (c: Col, v: unknown): unknown => {
      if (v === null || v === undefined || v === '') return '';
      if (c.money) return (Number(v) / 10 ** digits).toFixed(digits);
      if (c.percent) return `${(Number(v) * 100).toFixed(1)}%`;
      if (v instanceof Date || c.date) return formatInTimeZone(new Date(v as string), tz, c.date === 'datetime' ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
      return v;
    };
    const header = columns.map((c) => (c.money ? `${c.header} (${currency})` : c.header));
    const csv = [csvRow(header), ...rows.map((r) => csvRow(columns.map((c) => cell(c, r[c.key]))))].join('\r\n');
    // The period as the user picked it: `to` is the exclusive end, so the last day is the instant before it.
    const period = `${day(q.from)}_to_${day(new Date(q.to.getTime() - 1))}`;
    // Downloads leave the system (some reports list clients), so each one is audited.
    await this.audit.record({ action: 'report.exported', entityType: 'Organization', entityId: RequestContext.orgId(), summary: `${name} ${period.replace('_to_', ' – ')}, ${rows.length} rows` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}_${period}.csv"`);
    // BOM so Excel opens UTF-8 (names, ₨, em dashes) correctly.
    res.send(`\uFEFF${csv}\r\n`);
  }

  @Get('financial-summary')
  @RequirePermissions('reports.financial')
  @ApiZodQuery(reportQuery)
  async summary(@Query(zp(reportQuery)) q: Q, @Res() res: Response) {
    const data = await this.reports.financialSummary(q.from, q.to, q.branchId);
    // The CSV is a single summary row; the nested breakdowns stay in the JSON response.
    // The CSV lists each figure on its own row (Measure, Amount), then cash received per payment method and expenses per category.
    const m = (measure: string, amountMinor: number) => ({ measure, amountMinor });
    return this.send(res, q, 'financial-summary', data, [
      m('Gross billed (incl. tax)', data.grossBilledMinor),
      m('Credit notes', data.creditNotesMinor),
      m('Tax billed', data.taxBilledMinor),
      m('Net revenue', data.netRevenueMinor),
      m('Cost of goods', data.costOfGoodsMinor),
      m('Gross profit', data.grossProfitMinor),
      m('Expenses (excl. tax)', data.expensesMinor),
      m('Operating profit', data.operatingProfitMinor),
      m('Cash received (net of refunds)', data.cashReceivedMinor),
      m('Refunds', data.refundsMinor),
      m('Outstanding (all unpaid invoices)', data.outstandingMinor),
      ...data.paymentsByMethod.map((p) => m(`Received by ${enumLabel(p.method).toLowerCase()} (${p.count})`, p.amountMinor)),
      ...data.expensesByCategory.map((e) => m(`Expenses: ${enumLabel(e.category)}`, e.amountMinor)),
    ], [{ key: 'measure', header: 'Measure' }, { key: 'amountMinor', header: 'Amount', money: true }]);
  }

  @Get(':name')
  @RequireAnyPermission('reports.view', 'reports.financial')
  @ApiZodQuery(reportQuery)
  async named(@Param('name') name: string, @Query(zp(reportQuery)) q: Q, @Res() res: Response) {
    switch (name) {
      case 'sales-by-item': {
        const d = await this.reports.salesByItem(q.from, q.to, q.branchId);
        return this.send(res, q, name, d, [...d.rows, { item: 'Total', ...d.totals }], [
          { key: 'item', header: 'Item' }, { key: 'code', header: 'Code' }, { key: 'type', header: 'Type' }, { key: 'quantity', header: 'Quantity' }, ...SALES_COLS,
        ]);
      }
      case 'sales-by-category': {
        const d = await this.reports.salesByCategory(q.from, q.to, q.branchId);
        return this.send(res, q, name, d, [...d.rows, { group: 'Total', lines: d.rows.reduce((n, r) => n + r.lines, 0), netMinor: d.totalMinor, taxMinor: d.rows.reduce((n, r) => n + r.taxMinor, 0), grossMinor: d.rows.reduce((n, r) => n + r.grossMinor, 0) }], [
          { key: 'group', header: 'Category' }, { key: 'lines', header: 'Invoice lines' }, ...SALES_COLS,
        ]);
      }
      case 'aged-receivables': {
        const d = await this.reports.agedReceivables(q.branchId);
        const AGE: Record<string, string> = { current: 'Not yet due', d1_30: '1–30 days', d31_60: '31–60 days', d61_90: '61–90 days', d90plus: 'Over 90 days' };
        return this.send(res, q, name, d, d.invoices.map((i) => ({ ...i, client: i.client?.displayName ?? 'Counter sale', age: AGE[i.bucket] })), [
          { key: 'invoiceNo', header: 'Invoice' }, { key: 'client', header: 'Client' }, { key: 'issuedAt', header: 'Issued', date: 'date' }, { key: 'dueAt', header: 'Due', date: 'date' },
          { key: 'daysOverdue', header: 'Days overdue' }, { key: 'age', header: 'Age' }, { key: 'balanceMinor', header: 'Balance', money: true },
        ]);
      }
      case 'stock-valuation': {
        const d = await this.reports.stockValuation();
        return this.send(res, q, name, d, [...d.rows, { name: 'Total', valueMinor: d.totalMinor }], [
          { key: 'name', header: 'Product' }, { key: 'quantity', header: 'Quantity on hand' }, { key: 'unit', header: 'Unit' }, { key: 'valueMinor', header: 'Value at cost', money: true },
        ]);
      }
      case 'write-offs': {
        const d = await this.reports.writeOffs(q.from, q.to);
        return this.send(res, q, name, d, d.rows.map((r) => ({ date: r.createdAt, product: r.product.name, batch: r.batch.batchNumber, quantity: -r.quantity, unit: r.product.dispensingUnit, reason: r.reason, costMinor: r.costMinor })), [
          { key: 'date', header: 'Date', date: 'datetime' }, { key: 'product', header: 'Product' }, { key: 'batch', header: 'Batch' }, { key: 'quantity', header: 'Quantity written off' },
          { key: 'unit', header: 'Unit' }, { key: 'reason', header: 'Reason' }, { key: 'costMinor', header: 'Cost', money: true },
        ]);
      }
      case 'appointments': {
        const d = await this.reports.appointmentStats(q.from, q.to, q.branchId);
        return this.send(res, q, name, d, [
          ...Object.entries(d.byStatus).map(([status, count]) => ({ measure: enumLabel(status), value: count })),
          { measure: 'Total appointments', value: d.total },
          { measure: 'No-show rate', value: `${(d.noShowRate * 100).toFixed(1)}%` },
          { measure: 'Cancellation rate', value: `${(d.cancellationRate * 100).toFixed(1)}%` },
        ], [{ key: 'measure', header: 'Measure' }, { key: 'value', header: 'Value' }]);
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
          ...d.hospital.outcomes.map((r) => row('Hospital outcomes', enumLabel(r.outcome, 'outcome'), r.count)),
          row('Surgery', 'Completed', d.surgery.completed, `${d.surgery.withComplications} with complications recorded`),
          ...d.surgery.byProcedure.map((r) => row('Surgery by procedure (top 10)', r.procedure, r.count)),
          row('New patients', 'Total (all branches)', d.newPatients.total),
          ...d.newPatients.bySpecies.map((r) => row('New patients by species', r.species, r.count)),
        ], [{ key: 'section', header: 'Section' }, { key: 'item', header: 'Item' }, { key: 'count', header: 'Count' }, { key: 'detail', header: 'Detail' }]);
      }
      default:
        throw notFound('Report');
    }
  }
}
