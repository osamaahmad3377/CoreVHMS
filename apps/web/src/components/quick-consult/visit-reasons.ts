'use client';
import { answersToText, type TemplateIcon, type TemplateQuestionRow } from '@vcms/shared';
import { Ambulance, Baby, Bandage, BatteryLow, Beef, Bone, Brain, Bug, Droplets, Ear, Eye, FileText, FlaskConical, HeartPulse, PawPrint, PenLine, RotateCcw, Scissors, Smile, Soup, Stethoscope, Syringe, Thermometer, Truck, Wind, type LucideIcon } from 'lucide-react';
import { useAppointmentTypes, useTemplates } from '@/hooks/use-catalog';
import type { ClinicalTemplateRow } from '@/lib/types';

/** Vaccination, deworming and grooming: chosen by their category alone (no questions; their own panel instead). */
export type CareKind = 'VACCINATION' | 'DEWORMING' | 'GROOMING';

/**
 * A reason for the visit in the guided consultation = one of the clinic's appointment types (Settings → Appointment
 * types), with its consultation questions for the owner, exam focus, diagnoses and advice when it has them.
 */
export interface VisitReason {
  id: string;
  name: string;
  icon: string;
  complaint: string;
  /** The template's examination buttons (the standard set when empty). */
  examSystems: string[];
  questions: TemplateQuestionRow[];
  diagnoses: string[];
  advice: string[];
  template: ClinicalTemplateRow | null;
  /** The category it is chosen under in step 1. */
  categoryId: string;
}

/** A category in step 1: tap to see its appointment types — or, for vaccination / deworming / grooming, to choose it. */
export interface VisitCategory {
  id: string;
  name: string;
  kind: string;
  care: CareKind | null;
}

/** Which care panel a category opens: by what it works like, and by name for deworming (it works like vaccination). */
export function careOf(c: { name: string; kind: string }): CareKind | null {
  if (c.kind === 'GROOMING') return 'GROOMING';
  if (/deworm/i.test(c.name)) return 'DEWORMING';
  if (c.kind === 'VACCINATION') return 'VACCINATION';
  return null;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  CONSULTATION: Stethoscope,
  VACCINATION: Syringe,
  DEWORMING: Bug,
  GROOMING: Scissors,
  FOLLOW_UP: RotateCcw,
  SURGERY: HeartPulse,
  DENTAL: Smile,
  DIAGNOSTICS: FlaskConical,
  EMERGENCY: Ambulance,
  FIELD_VISIT: Truck,
};
export const categoryIcon = (c: VisitCategory): LucideIcon => CATEGORY_ICONS[c.care ?? c.kind] ?? FileText;

const CARE_NAMES: Record<CareKind, string> = { VACCINATION: 'Vaccination', DEWORMING: 'Deworming', GROOMING: 'Grooming' };
export { answersToText };

export const TEMPLATE_ICON_COMPONENTS: Record<TemplateIcon, LucideIcon> = {
  stethoscope: Stethoscope,
  soup: Soup,
  paw: PawPrint,
  ear: Ear,
  eye: Eye,
  bone: Bone,
  battery: BatteryLow,
  wind: Wind,
  bandage: Bandage,
  droplets: Droplets,
  recheck: RotateCcw,
  pen: PenLine,
  heart: HeartPulse,
  brain: Brain,
  thermometer: Thermometer,
  tooth: Smile,
  baby: Baby,
  scissors: Scissors,
  cow: Beef,
  file: FileText,
};
export const reasonIcon = (icon: string): LucideIcon => TEMPLATE_ICON_COMPONENTS[icon as TemplateIcon] ?? FileText;

const fromTemplate = (t: ClinicalTemplateRow | null) => ({
  icon: t?.icon ?? 'file',
  complaint: t?.presentingComplaint ?? '',
  examSystems: t?.examSystems ?? [],
  questions: t?.questions ?? [],
  diagnoses: t?.diagnoses ?? [],
  advice: t?.advice ?? [],
  template: t,
});

/**
 * The clinic's categories and active appointment types for this kind of animal, as reasons for the visit. A
 * template not (yet) used by any type is offered under Consultation, so no questions are lost.
 */
export function useVisitReasons(speciesCategory?: string | null) {
  const types = useAppointmentTypes();
  const templates = useTemplates();
  const byId = new Map((templates.data ?? []).map((t) => [t.id, t]));
  const forAnimal = (t: ClinicalTemplateRow | null | undefined) => !t?.speciesCategory || !speciesCategory || t.speciesCategory === speciesCategory;

  // Categories in the clinic's order (the types come sorted by category).
  const all: VisitCategory[] = [];
  for (const t of types.data ?? []) {
    const c = t.categoryRef && t.categoryRef.isActive ? t.categoryRef : { id: `kind:${t.category}`, name: CARE_NAMES[t.category as CareKind] ?? t.category.charAt(0) + t.category.slice(1).toLowerCase().replace('_', ' '), kind: t.category };
    if (!all.some((x) => x.id === c.id)) all.push({ id: c.id, name: c.name, kind: c.kind, care: careOf(c) });
  }
  const consultation = all.find((c) => !c.care && c.kind === 'CONSULTATION') ?? { id: 'kind:CONSULTATION', name: 'Consultation', kind: 'CONSULTATION', care: null };

  const reasons: VisitReason[] = [];
  for (const t of types.data ?? []) {
    const tpl = t.templateId ? (byId.get(t.templateId) ?? null) : null;
    if (!forAnimal(tpl)) continue;
    const categoryId = t.categoryRef && t.categoryRef.isActive ? t.categoryRef.id : `kind:${t.category}`;
    reasons.push({ id: t.id, name: t.name, categoryId, ...fromTemplate(tpl) });
  }
  const used = new Set((types.data ?? []).map((t) => t.templateId).filter(Boolean));
  for (const tpl of templates.data ?? []) {
    if (tpl.isActive && !used.has(tpl.id) && forAnimal(tpl)) reasons.push({ id: tpl.id, name: tpl.name, categoryId: consultation.id, ...fromTemplate(tpl) });
  }

  // Vaccination, deworming and grooming are always there (one tile each); other categories when they have a type.
  const categories: VisitCategory[] = [];
  for (const c of [...all, ...(all.includes(consultation) ? [] : [consultation])]) {
    if (c.care ? categories.some((x) => x.care === c.care) : !reasons.some((r) => r.categoryId === c.id)) continue;
    categories.push(c);
  }
  for (const k of ['VACCINATION', 'DEWORMING', 'GROOMING'] as CareKind[]) {
    if (!categories.some((c) => c.care === k)) categories.push({ id: `care:${k}`, name: CARE_NAMES[k], kind: k, care: k });
  }
  return { reasons, categories, isLoading: types.isLoading || templates.isLoading, error: types.error ?? templates.error };
}

/**
 * Several reasons for one visit (e.g. vomiting and an ear problem) as one: every template's questions — a question
 * both ask (same wording) only once — their examination buttons, suggested diagnoses and advice together.
 */
export function combineReasons(list: VisitReason[]): VisitReason | null {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const norm = (s: string) => s.trim().toLowerCase();
  const unique = (xs: string[]) => xs.filter((x, i) => xs.findIndex((y) => norm(y) === norm(x)) === i);
  const questions: TemplateQuestionRow[] = [];
  for (const q of list.flatMap((r) => r.questions)) if (!questions.some((x) => norm(x.ask) === norm(q.ask))) questions.push(q);
  return {
    id: list.map((r) => r.id).join('+'),
    name: list.map((r) => r.name).join(' + '),
    icon: list[0].icon,
    complaint: list.map((r) => r.complaint || r.name).join(', '),
    // A template without its own buttons uses the standard set, so the visit does too.
    examSystems: list.some((r) => !r.examSystems.length) ? [] : unique(list.flatMap((r) => r.examSystems)),
    questions,
    diagnoses: unique(list.flatMap((r) => r.diagnoses)),
    advice: unique(list.flatMap((r) => r.advice)),
    template: list[0].template,
    categoryId: list[0].categoryId,
  };
}
