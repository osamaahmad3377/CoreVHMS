import type { CertificateKind, CertificateLayout, CertificateSubject, CertificateVaccinationRow } from '@vcms/shared';

export interface CertificateTemplateRow {
  id: string;
  kind: CertificateKind;
  kindLabel: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  updatedAt: string;
  updatedByName: string | null;
  used: number;
}
export interface CertificateTemplateDetail extends CertificateTemplateRow {
  layout: CertificateLayout;
}

export interface CertificateRow {
  id: string;
  certificateNo: string;
  kind: CertificateKind;
  kindLabel: string;
  subject: CertificateSubject;
  title: string;
  subjectName: string;
  patient: { id: string; name: string; patientNo: string; species: string } | null;
  membership: { id: string; name: string; jobTitle: string | null } | null;
  issuedAt: string;
  validUntil: string | null;
  issuedByName: string;
  status: 'ISSUED' | 'REVOKED';
  state: 'VALID' | 'EXPIRED' | 'REVOKED';
  revokedAt: string | null;
  revokedByName: string | null;
  revokedReason: string | null;
  verificationCode: string;
  templateName: string;
}
export interface CertificateDetail extends CertificateRow {
  inputs: Record<string, string>;
  data: { fields: Record<string, string>; table: CertificateVaccinationRow[] };
  layout: CertificateLayout;
  contentHash: string;
  verifyUrl: string;
  encounterId: string | null;
  templateId: string | null;
  replacedBy: { id: string; certificateNo: string } | null;
  replaces: { id: string; certificateNo: string } | null;
}
export interface CertificatePrefill {
  inputs: Record<string, string>;
  validUntil: string | null;
  vaccinations: { id: string; vaccine: string; product: string; batch: string; givenOn: string; nextDue: string; givenBy: string }[];
}
