/**
 * Dental charting reference data: tooth numbering (modified Triadan system), finding and procedure codes and the
 * scoring scales. These are standard veterinary dental nomenclature (anatomy and AVDC abbreviations), not
 * treatment recommendations — the chart records what the vet found and did.
 *
 * Triadan numbers: the first digit is the quadrant (1 upper right, 2 upper left, 3 lower left, 4 lower right;
 * 5–8 the same for baby teeth), the last two the position from the midline (01–03 incisors, 04 canine,
 * 05–08 premolars, 09–11 molars). So 108 is the upper right fourth premolar and 309 the lower left first molar.
 */

export const DENTITIONS = ['CANINE', 'FELINE', 'EQUINE'] as const;
export type Dentition = (typeof DENTITIONS)[number];

export const DENTITION_LABELS: Record<Dentition, string> = { CANINE: 'Dog', FELINE: 'Cat', EQUINE: 'Horse' };

export type ToothType = 'incisor' | 'canine' | 'premolar' | 'molar';
export interface ToothInfo {
  /** Triadan number, e.g. "104". */
  id: string;
  quadrant: number;
  position: number;
  type: ToothType;
  upper: boolean;
  /** Patient's right side. */
  right: boolean;
  deciduous: boolean;
  /** e.g. "Upper right canine (104)". */
  name: string;
  /** e.g. "C", "P4", "M1", "I2". */
  short: string;
}

/** Positions present in each quadrant: [upper, lower], permanent then deciduous. */
const POSITIONS: Record<Dentition, { permanent: [number[], number[]]; deciduous: [number[], number[]] }> = {
  // Dog: 42 adult teeth (I3/3 C1/1 P4/4 M2/3), 28 baby teeth (i3/3 c1/1 p3/3).
  CANINE: { permanent: [range(1, 10), range(1, 11)], deciduous: [[1, 2, 3, 4, 6, 7, 8], [1, 2, 3, 4, 6, 7, 8]] },
  // Cat: 30 adult teeth (I3/3 C1/1 P3/2 M1/1), 26 baby teeth (i3/3 c1/1 p3/2).
  FELINE: { permanent: [[1, 2, 3, 4, 6, 7, 8, 9], [1, 2, 3, 4, 7, 8, 9]], deciduous: [[1, 2, 3, 4, 6, 7, 8], [1, 2, 3, 4, 7, 8]] },
  // Horse: up to 44 adult teeth (canines and wolf teeth 05 are often absent), 24 baby teeth (incisors and cheek teeth).
  EQUINE: { permanent: [range(1, 11), range(1, 11)], deciduous: [[1, 2, 3, 6, 7, 8], [1, 2, 3, 6, 7, 8]] },
};

function range(a: number, b: number) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const ORDINAL = ['', 'first', 'second', 'third', 'fourth'];

function toothType(position: number): ToothType {
  if (position <= 3) return 'incisor';
  if (position === 4) return 'canine';
  if (position <= 8) return 'premolar';
  return 'molar';
}

function describe(dentition: Dentition, quadrant: number, position: number): ToothInfo {
  const deciduous = quadrant >= 5;
  const q = deciduous ? quadrant - 4 : quadrant;
  const upper = q === 1 || q === 2;
  const right = q === 1 || q === 4;
  const type = toothType(position);
  const id = `${quadrant}${String(position).padStart(2, '0')}`;
  const n = type === 'incisor' ? position : type === 'premolar' ? position - 4 : type === 'molar' ? position - 8 : 0;
  const letter = { incisor: 'I', canine: 'C', premolar: 'P', molar: 'M' }[type];
  let kind = type === 'canine' ? 'canine' : `${ORDINAL[n]} ${type}`;
  if (dentition === 'EQUINE' && position === 5) kind = 'wolf tooth (first premolar)';
  const side = `${upper ? 'Upper' : 'Lower'} ${right ? 'right' : 'left'}`;
  return {
    id,
    quadrant,
    position,
    type,
    upper,
    right,
    deciduous,
    name: `${side} ${deciduous ? 'baby ' : ''}${kind} (${id})`,
    short: deciduous ? `${letter.toLowerCase()}${n || ''}` : `${letter}${n || ''}`,
  };
}

/** Every tooth of a dentition (adult, or baby teeth with `deciduous`), in chart order per quadrant. */
export function teethFor(dentition: Dentition, deciduous = false): ToothInfo[] {
  const set = POSITIONS[dentition][deciduous ? 'deciduous' : 'permanent'];
  const quadrants = deciduous ? [5, 6, 7, 8] : [1, 2, 3, 4];
  return quadrants.flatMap((quadrant) => {
    const upper = quadrant % 4 === 1 || quadrant % 4 === 2;
    return set[upper ? 0 : 1].map((p) => describe(dentition, quadrant, p));
  });
}

const TOOTH_INDEX = new Map<string, Map<string, ToothInfo>>();
/** The tooth with this Triadan number in a dentition (adult or baby), or null if that tooth doesn't exist. */
export function toothInfo(dentition: Dentition, id: string): ToothInfo | null {
  let m = TOOTH_INDEX.get(dentition);
  if (!m) {
    m = new Map([...teethFor(dentition), ...teethFor(dentition, true)].map((t) => [t.id, t]));
    TOOTH_INDEX.set(dentition, m);
  }
  return m.get(id) ?? null;
}

/** Usual dentition for a species name (null = no tooth chart template; the vet can still pick one). */
export function dentitionForSpecies(name: string | null | undefined, category?: string | null): Dentition | null {
  const n = (name ?? '').toLowerCase();
  if (/\b(dog|canine|puppy)\b/.test(n)) return 'CANINE';
  if (/\b(cat|feline|kitten)\b/.test(n)) return 'FELINE';
  if (/\b(horse|equine|pony|donkey|mule|foal)\b/.test(n) || category === 'EQUINE') return 'EQUINE';
  return null;
}

// ── Tooth state ──

export const TOOTH_STATES = ['PRESENT', 'MISSING', 'UNERUPTED', 'EXTRACTED'] as const;
export type ToothState = (typeof TOOTH_STATES)[number];
export const TOOTH_STATE_LABELS: Record<ToothState, string> = {
  PRESENT: 'Present',
  MISSING: 'Missing',
  UNERUPTED: 'Unerupted',
  EXTRACTED: 'Extracted previously',
};

// ── Findings (per tooth) ──

export interface DentalCode {
  code: string;
  /** Abbreviation printed on the chart (AVDC style). */
  abbr: string;
  label: string;
  /** Only offered for these dentitions (all when omitted). */
  dentitions?: Dentition[];
  hint?: string;
}

export const DENTAL_FINDINGS: readonly DentalCode[] = [
  { code: 'CA', abbr: 'CA', label: 'Caries (cavity)' },
  { code: 'FX_UCF', abbr: 'UCF', label: 'Crown fracture, pulp not exposed' },
  { code: 'FX_CCF', abbr: 'CCF', label: 'Crown fracture, pulp exposed', hint: 'Complicated fracture: the pulp (nerve) is open.' },
  { code: 'FX_RF', abbr: 'RF', label: 'Root fracture' },
  { code: 'TR', abbr: 'TR', label: 'Tooth resorption', hint: 'Record the stage (1–5).' },
  { code: 'RD', abbr: 'RD', label: 'Retained baby tooth', hint: 'Persistent deciduous tooth.' },
  { code: 'RTR', abbr: 'RTR', label: 'Retained root' },
  { code: 'PA', abbr: 'PA', label: 'Root abscess / periapical lesion' },
  { code: 'AT', abbr: 'AT', label: 'Attrition (tooth-on-tooth wear)' },
  { code: 'AB', abbr: 'AB', label: 'Abrasion (wear from chewing objects)' },
  { code: 'DT', abbr: 'DT', label: 'Discoloured tooth' },
  { code: 'EH', abbr: 'EH', label: 'Enamel defect / hypoplasia' },
  { code: 'GR', abbr: 'GR', label: 'Gum recession' },
  { code: 'GE', abbr: 'GE', label: 'Gum overgrowth (gingival enlargement)' },
  { code: 'MP', abbr: 'MP', label: 'Malpositioned, rotated or crowded' },
  { code: 'OM', abbr: 'OM', label: 'Oral mass at this tooth' },
  { code: 'SEP', abbr: 'SEP', label: 'Sharp enamel points', dentitions: ['EQUINE'] },
  { code: 'HOOK', abbr: 'HK', label: 'Hook', dentitions: ['EQUINE'] },
  { code: 'RAMP', abbr: 'RP', label: 'Ramp', dentitions: ['EQUINE'] },
  { code: 'DIA', abbr: 'DIA', label: 'Diastema (gap with food packing)', dentitions: ['EQUINE'] },
  { code: 'EOTRH', abbr: 'EOTRH', label: 'EOTRH (resorption and hypercementosis)', dentitions: ['EQUINE'] },
];

// ── Procedures ──

export interface DentalProcedureCode extends DentalCode {
  /** Done on a tooth, on the whole mouth, or either. */
  scope: 'tooth' | 'mouth' | 'both';
  /** The tooth is gone afterwards (next chart starts with it extracted). */
  removesTooth?: boolean;
}

export const DENTAL_PROCEDURES: readonly DentalProcedureCode[] = [
  { code: 'SP', abbr: 'S/P', label: 'Scale and polish', scope: 'mouth' },
  { code: 'XR', abbr: 'RAD', label: 'Dental X-rays', scope: 'both' },
  { code: 'X', abbr: 'X', label: 'Extraction (simple)', scope: 'tooth', removesTooth: true },
  { code: 'XS', abbr: 'XS', label: 'Surgical extraction', scope: 'tooth', removesTooth: true },
  { code: 'RP', abbr: 'RP', label: 'Root planing', scope: 'tooth' },
  { code: 'PSG', abbr: 'PSG', label: 'Periodontal flap surgery', scope: 'tooth' },
  { code: 'PCT', abbr: 'PCT', label: 'Local antibiotic gel (perioceutic)', scope: 'tooth' },
  { code: 'GV', abbr: 'GV', label: 'Gum surgery (gingivoplasty)', scope: 'both' },
  { code: 'R', abbr: 'R', label: 'Restoration (filling)', scope: 'tooth' },
  { code: 'RCT', abbr: 'RCT', label: 'Root canal treatment', scope: 'tooth' },
  { code: 'VPT', abbr: 'VPT', label: 'Vital pulp therapy', scope: 'tooth' },
  { code: 'CR', abbr: 'CR', label: 'Crown', scope: 'tooth' },
  { code: 'OC', abbr: 'OC', label: 'Crown reduction (odontoplasty)', scope: 'tooth' },
  { code: 'B', abbr: 'B', label: 'Biopsy', scope: 'both' },
  { code: 'FLOAT', abbr: 'FLT', label: 'Float (rasp cheek teeth)', scope: 'mouth', dentitions: ['EQUINE'] },
  { code: 'WOLF', abbr: 'WTX', label: 'Wolf tooth removal', scope: 'tooth', removesTooth: true, dentitions: ['EQUINE'] },
];

export const DENTAL_FINDING_CODES = DENTAL_FINDINGS.map((f) => f.code) as [string, ...string[]];
export const DENTAL_PROCEDURE_CODES = DENTAL_PROCEDURES.map((p) => p.code) as [string, ...string[]];

export const dentalFinding = (code: string) => DENTAL_FINDINGS.find((f) => f.code === code) ?? null;
export const dentalProcedure = (code: string) => DENTAL_PROCEDURES.find((p) => p.code === code) ?? null;
export const forDentition = <T extends DentalCode>(list: readonly T[], d: Dentition) => list.filter((c) => !c.dentitions || c.dentitions.includes(d));

// ── Scales ──

export interface ScaleStep {
  value: number;
  label: string;
  hint: string;
}

/** Periodontal disease stage (AVDC). */
export const PERIODONTAL_STAGES: ScaleStep[] = [
  { value: 0, label: 'PD0', hint: 'Healthy' },
  { value: 1, label: 'PD1', hint: 'Gingivitis only, no attachment loss' },
  { value: 2, label: 'PD2', hint: 'Early periodontitis (under 25% attachment loss)' },
  { value: 3, label: 'PD3', hint: 'Moderate periodontitis (25–50% attachment loss)' },
  { value: 4, label: 'PD4', hint: 'Advanced periodontitis (over 50% attachment loss)' },
];
export const CALCULUS_INDEX: ScaleStep[] = [
  { value: 0, label: 'CI0', hint: 'No tartar' },
  { value: 1, label: 'CI1', hint: 'Tartar on under a third of the crown' },
  { value: 2, label: 'CI2', hint: 'Tartar on a third to two thirds of the crown' },
  { value: 3, label: 'CI3', hint: 'Tartar on over two thirds of the crown' },
];
export const GINGIVAL_INDEX: ScaleStep[] = [
  { value: 0, label: 'GI0', hint: 'Healthy gum' },
  { value: 1, label: 'GI1', hint: 'Mild redness, no bleeding when probed' },
  { value: 2, label: 'GI2', hint: 'Red and swollen, bleeds when probed' },
  { value: 3, label: 'GI3', hint: 'Very red and swollen, bleeds by itself, ulcerated' },
];
export const MOBILITY_INDEX: ScaleStep[] = [
  { value: 0, label: 'M0', hint: 'Not loose' },
  { value: 1, label: 'M1', hint: 'Slightly loose (up to 0.5 mm)' },
  { value: 2, label: 'M2', hint: 'Loose (0.5–1 mm)' },
  { value: 3, label: 'M3', hint: 'Very loose (over 1 mm, or moves up and down)' },
];
export const FURCATION_INDEX: ScaleStep[] = [
  { value: 0, label: 'F0', hint: 'No furcation exposure' },
  { value: 1, label: 'F1', hint: 'Probe goes under a third of the way between the roots' },
  { value: 2, label: 'F2', hint: 'Probe goes more than a third of the way, not through' },
  { value: 3, label: 'F3', hint: 'Probe goes right through between the roots' },
];
export const TR_STAGES: ScaleStep[] = [
  { value: 1, label: 'TR1', hint: 'Enamel or cementum only' },
  { value: 2, label: 'TR2', hint: 'Into the dentin' },
  { value: 3, label: 'TR3', hint: 'Deep dentin, pulp intact' },
  { value: 4, label: 'TR4', hint: 'Extensive, crown and root weakened' },
  { value: 5, label: 'TR5', hint: 'Only remnants left under the gum' },
];

export const OCCLUSIONS = ['NORMAL', 'MAL1', 'MAL2', 'MAL3', 'MAL4', 'LEVEL'] as const;
export type Occlusion = (typeof OCCLUSIONS)[number];
export const OCCLUSION_LABELS: Record<Occlusion, string> = {
  NORMAL: 'Normal (scissor bite)',
  LEVEL: 'Level bite',
  MAL1: 'Class 1 – a tooth out of place, jaws normal',
  MAL2: 'Class 2 – overshot (lower jaw short)',
  MAL3: 'Class 3 – undershot (lower jaw long)',
  MAL4: 'Class 4 – asymmetric (wry bite)',
};

/** Worst periodontal stage recorded on any tooth (null when none recorded). */
export function worstStage(teeth: { pdStage?: number | null }[]): number | null {
  const s = teeth.map((t) => t.pdStage).filter((v): v is number => typeof v === 'number');
  return s.length ? Math.max(...s) : null;
}
