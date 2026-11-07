'use client';
import { answersToText, type TemplateIcon, type TemplateQuestionRow } from '@vcms/shared';
import { Baby, Bandage, BatteryLow, Beef, Bone, Brain, Droplets, Ear, Eye, FileText, HeartPulse, PawPrint, PenLine, RotateCcw, Scissors, Smile, Soup, Stethoscope, Thermometer, Wind, type LucideIcon } from 'lucide-react';
import { useTemplates } from '@/hooks/use-catalog';
import type { ClinicalTemplateRow } from '@/lib/types';

/**
 * A reason for the visit in the guided consultation = one of the clinic's consultation templates
 * (Settings → Consultation templates), with its questions for the owner, exam focus, diagnoses and advice.
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
  template: ClinicalTemplateRow;
}
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

/** The clinic's active templates for this kind of animal, as reasons for the visit. */
export function useVisitReasons(speciesCategory?: string | null) {
  const q = useTemplates();
  const reasons: VisitReason[] = (q.data ?? [])
    .filter((t) => t.isActive && (!t.speciesCategory || !speciesCategory || t.speciesCategory === speciesCategory))
    .map((t) => ({ id: t.id, name: t.name, icon: t.icon, complaint: t.presentingComplaint ?? '', examSystems: t.examSystems, questions: t.questions ?? [], diagnoses: t.diagnoses ?? [], advice: t.advice ?? [], template: t }));
  return { reasons, isLoading: q.isLoading, error: q.error };
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
  };
}
