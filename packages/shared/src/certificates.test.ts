import {
  CERTIFICATE_KINDS,
  CERTIFICATE_KIND_INFO,
  CERTIFICATE_STYLES,
  CODE128_PATTERNS,
  certificateFields,
  certificateLayoutSchema,
  code128,
  defaultCertificateLayout,
  fillPlaceholders,
  formatVerificationCode,
  issueCertificateSchema,
  normaliseVerificationCode,
  pageMm,
  sampleCertificateData,
} from './certificates';
import { ALL_PERMISSIONS, SYSTEM_ROLE_TEMPLATES } from './permissions';

describe('certificates', () => {
  it('has a ready-made design for every kind and style that passes its own checks and fits the page', () => {
    for (const kind of CERTIFICATE_KINDS) {
      for (const style of CERTIFICATE_STYLES) {
        const layout = defaultCertificateLayout(kind, style);
        expect(certificateLayoutSchema.safeParse(layout).success).toBe(true);
        const { w, h } = pageMm(layout.page);
        for (const el of layout.elements) {
          expect(el.x).toBeGreaterThanOrEqual(0);
          expect(el.x + el.w).toBeLessThanOrEqual(w + 0.01);
          expect(el.y + el.h).toBeLessThanOrEqual(h + 0.01);
        }
        expect(new Set(layout.elements.map((e) => e.id)).size).toBe(layout.elements.length);
        // Every design carries the verification QR code.
        expect(layout.elements.some((e) => e.type === 'qr')).toBe(true);
      }
    }
    // The vaccination certificate lists the vaccinations.
    expect(defaultCertificateLayout('VACCINATION').elements.some((e) => e.type === 'table')).toBe(true);
  });

  it('fills placeholders, and every placeholder in the wording is one the template knows', () => {
    expect(fillPlaceholders('Hello {{ patient.name }}, {{unknown}}!', { 'patient.name': 'Bruno' })).toBe('Hello Bruno, !');
    for (const kind of CERTIFICATE_KINDS) {
      const known = new Set(certificateFields(kind).map((f) => f.key));
      for (const [, key] of CERTIFICATE_KIND_INFO[kind].statement.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) expect(known.has(key)).toBe(true);
      for (const el of defaultCertificateLayout(kind).elements) {
        if (el.type !== 'text') continue;
        for (const [, key] of el.text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) expect([kind, key, known.has(key)]).toEqual([kind, key, true]);
      }
      expect(sampleCertificateData(kind)['certificate.statement']).not.toMatch(/\{\{/);
    }
  });

  it('checks what is needed to issue each kind', () => {
    const r = issueCertificateSchema.safeParse({ kind: 'FITNESS_TO_TRAVEL', patientId: '00000000-0000-4000-8000-000000000001', inputs: { examDate: '2026-11-04' } });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('Destination is required');
    expect(issueCertificateSchema.safeParse({ kind: 'EMPLOYMENT', patientId: '00000000-0000-4000-8000-000000000001', inputs: {} }).success).toBe(false);
    expect(issueCertificateSchema.safeParse({ kind: 'EMPLOYMENT', membershipId: '00000000-0000-4000-8000-000000000001', inputs: {} }).success).toBe(true);
    expect(issueCertificateSchema.safeParse({ kind: 'TRAINING', membershipId: '00000000-0000-4000-8000-000000000001', inputs: { course: 'X', completedOn: '4 Nov' } }).success).toBe(false);
  });

  it('encodes Code 128 barcodes', () => {
    // Every symbol is 11 modules wide (the stop symbol 13), and all symbols differ.
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((p, i) => expect([...p].reduce((n, d) => n + Number(d), 0)).toBe(i === 106 ? 13 : 11));
    const bars = code128('CERT-000123');
    // Start B + 11 characters + checksum + stop.
    expect(bars.reduce((n, d) => n + d, 0)).toBe(11 * 13 + 13);
    // "PJJ123C" check digit: (104 + Σ value × position) mod 103.
    const values = [...'PJJ123C'].map((c) => c.charCodeAt(0) - 32);
    const check = (104 + values.reduce((n, v, i) => n + v * (i + 1), 0)) % 103;
    expect(code128('PJJ123C').slice(-7 - 6, -7).join('')).toBe(CODE128_PATTERNS[check]);
    expect(() => code128('é')).toThrow();
  });

  it('formats verification codes for people and reads them back however they were typed', () => {
    expect(formatVerificationCode('K7Q2M9XP4TRA')).toBe('K7Q2-M9XP-4TRA');
    expect(normaliseVerificationCode(' k7q2-m9xp 4tra ')).toBe('K7Q2M9XP4TRA');
  });

  it('gives clinic roles the certificate permissions', () => {
    for (const p of ['certificates.read', 'certificates.issue', 'certificates.staff', 'certificates.templates']) expect(ALL_PERMISSIONS).toContain(p);
    const role = (k: string) => SYSTEM_ROLE_TEMPLATES.find((r) => r.key === k)!.permissions;
    expect(role('veterinarian')).toEqual(expect.arrayContaining(['certificates.read', 'certificates.issue']));
    expect(role('veterinarian')).not.toContain('certificates.staff');
    expect(role('practice_manager')).toEqual(expect.arrayContaining(['certificates.staff', 'certificates.templates']));
    expect(role('receptionist')).toContain('certificates.read');
    expect(role('receptionist')).not.toContain('certificates.issue');
  });
});

describe('certificate text', () => {
  it('leaves out lines with nothing known', () => {
    const { fillCertificateText } = jest.requireActual('./certificates');
    expect(fillCertificateText('Name: {{patient.name}}\nMicrochip: {{patient.microchip}}\nThank you', { 'patient.name': 'Bruno', 'patient.microchip': '' })).toBe('Name: Bruno\nThank you');
    expect(fillCertificateText('{{a}} / {{b}}', { a: 'x' })).toBe('x / ');
  });
});

describe('watermarks', () => {
  it('are a layout element with an opacity between 2% and 100%', () => {
    const base = defaultCertificateLayout('HEALTH');
    const mark = { id: 'w1', type: 'watermark', mode: 'text', text: 'ORIGINAL', src: 'logo', fontSize: 60, fontFamily: 'serif', fontWeight: 700, color: '#888888', opacity: 0.12, x: 20, y: 120, w: 170, h: 50, rotate: -30 };
    expect(certificateLayoutSchema.safeParse({ ...base, elements: [mark, ...base.elements] }).success).toBe(true);
    expect(certificateLayoutSchema.safeParse({ ...base, elements: [{ ...mark, opacity: 0.001 }] }).success).toBe(false);
    expect(certificateLayoutSchema.safeParse({ ...base, elements: [{ ...mark, opacity: 1.5 }] }).success).toBe(false);
    expect(certificateLayoutSchema.safeParse({ ...base, elements: [{ ...mark, mode: 'image', src: 'logo' }] }).success).toBe(true);
    expect(certificateLayoutSchema.safeParse({ ...base, elements: [{ ...mark, mode: 'image', src: 'http://evil.example/x.png' }] }).success).toBe(false);
  });
});
