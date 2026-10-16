import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Builds a factual clinical summary from signed records (signalment, problems, diagnoses, latest signed
 * assessments and plans) for referral letters and insurance claims. Draft notes are never included.
 */
@Injectable()
export class ClinicalSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async forPeriod(patientId: string, from?: Date, to?: Date) {
    const db = this.prisma.db;
    const period = from || to ? { gte: from, lte: to } : undefined;
    const [patient, problems, diagnoses, notes, weight] = await Promise.all([
      db.patient.findUnique({ where: { id: patientId }, select: { name: true, sex: true, dateOfBirth: true, species: { select: { name: true } }, breed: { select: { name: true } }, breedText: true, latestWeightKg: true } }),
      db.problemListItem.findMany({ where: { patientId, status: 'ACTIVE' }, select: { term: true, isChronic: true, onsetDate: true }, orderBy: { createdAt: 'asc' } }),
      db.diagnosis.findMany({ where: { patientId, createdAt: period, status: { not: 'RULED_OUT' } }, select: { term: true, type: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
      db.clinicalNote.findMany({ where: { patientId, status: 'SIGNED', signedAt: period ?? { not: null } }, select: { signedAt: true, presentingComplaint: true, assessment: true, plan: true, signedByName: true }, orderBy: { signedAt: 'desc' }, take: 5 }),
      db.weightRecord.findFirst({ where: { patientId }, orderBy: { measuredAt: 'desc' }, select: { weightKg: true, measuredAt: true } }),
    ]);
    return {
      patient: patient ? { ...patient, latestWeightKg: patient.latestWeightKg === null ? null : Number(patient.latestWeightKg) } : null,
      problems,
      diagnoses,
      notes,
      weight: weight ? { weightKg: Number(weight.weightKg), measuredAt: weight.measuredAt } : null,
    };
  }

  /** Plain-text version for pre-filling a referral or claim (the clinician edits it before sending). */
  async text(patientId: string, from?: Date, to?: Date) {
    const s = await this.forPeriod(patientId, from, to);
    const lines: string[] = [];
    if (s.weight) lines.push(`Latest weight: ${s.weight.weightKg} kg (${s.weight.measuredAt.toISOString().slice(0, 10)})`);
    if (s.problems.length) lines.push(`Active problems: ${s.problems.map((p) => p.term + (p.isChronic ? ' (chronic)' : '')).join('; ')}`);
    if (s.diagnoses.length) lines.push(`Diagnoses: ${[...new Set(s.diagnoses.map((d) => `${d.term} (${d.type.toLowerCase()})`))].join('; ')}`);
    for (const n of s.notes) {
      lines.push('');
      lines.push(`${n.signedAt?.toISOString().slice(0, 10)} — ${n.signedByName ?? ''}${n.presentingComplaint ? `: ${n.presentingComplaint}` : ''}`);
      if (n.assessment) lines.push(`Assessment: ${n.assessment}`);
      if (n.plan) lines.push(`Plan: ${n.plan}`);
    }
    return { text: lines.join('\n').trim(), basedOn: { notes: s.notes.length, diagnoses: s.diagnoses.length, problems: s.problems.length } };
  }
}
