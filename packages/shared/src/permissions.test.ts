import { ALL_PERMISSIONS, SYSTEM_ROLE_TEMPLATES, hasPermission, isPermission } from './permissions';

describe('permissions', () => {
  it('has unique permission keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('role templates only reference catalogue permissions', () => {
    for (const role of SYSTEM_ROLE_TEMPLATES) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
    }
  });

  it('owner has every permission', () => {
    const owner = SYSTEM_ROLE_TEMPLATES.find((r) => r.key === 'owner')!;
    expect(owner.permissions.length).toBe(ALL_PERMISSIONS.length);
  });

  it('separates clinical and financial permissions for receptionists', () => {
    const r = SYSTEM_ROLE_TEMPLATES.find((x) => x.key === 'receptionist')!;
    expect(hasPermission(r.permissions, 'clinical.sign')).toBe(false);
    expect(hasPermission(r.permissions, 'billing.void')).toBe(false);
    expect(hasPermission(r.permissions, 'payments.take')).toBe(true);
  });

  it('lab technicians cannot release results', () => {
    const r = SYSTEM_ROLE_TEMPLATES.find((x) => x.key === 'lab_technician')!;
    expect(hasPermission(r.permissions, 'lab.result')).toBe(true);
    expect(hasPermission(r.permissions, 'lab.approve')).toBe(false);
  });

  it('hasPermission requires all listed permissions', () => {
    expect(hasPermission(['clients.read'], ['clients.read', 'clients.write'])).toBe(false);
    expect(hasPermission(new Set(['clients.read', 'clients.write']), ['clients.read', 'clients.write'])).toBe(true);
  });
});
