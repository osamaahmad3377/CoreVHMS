import { resetEnvCache } from '../../config/env';
import { addressFor, classifyHost, isAllowedOrigin } from './hosts';
import { databaseUrl, tenantDatabaseName } from './tenant-databases';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://vcms:pw@db:5432/vcms_platform?schema=public',
  SESSION_SECRET: 'x'.repeat(40),
  ENCRYPTION_KEY: 'ab'.repeat(32),
  APP_URL: 'https://nextcore.net.au',
};

function withEnv(extra: Record<string, string | undefined>, fn: () => void) {
  const saved = { ...process.env };
  Object.assign(process.env, BASE_ENV, extra);
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete process.env[k];
  resetEnvCache();
  try {
    fn();
  } finally {
    process.env = saved;
    resetEnvCache();
  }
}

describe('multi-clinic addresses', () => {
  it('maps subdomains to clinics, the super admin area and the bare domain', () => {
    withEnv({ BASE_DOMAIN: 'nextcore.net.au' }, () => {
      expect(classifyHost('happy-paws.nextcore.net.au')).toEqual({ kind: 'tenant', slug: 'happy-paws' });
      expect(classifyHost('Happy-Paws.NextCore.net.au:443')).toEqual({ kind: 'tenant', slug: 'happy-paws' });
      expect(classifyHost('admin.nextcore.net.au')).toEqual({ kind: 'platform' });
      expect(classifyHost('nextcore.net.au')).toEqual({ kind: 'root' });
      expect(classifyHost('www.nextcore.net.au')).toEqual({ kind: 'root' });
      // Reserved names, bad shapes, nested subdomains and other domains are not clinics.
      for (const h of ['api.nextcore.net.au', 'a.b.nextcore.net.au', 'ab.nextcore.net.au', '-x-.nextcore.net.au', 'evil.com', 'nextcore.net.au.evil.com', '']) {
        expect(classifyHost(h).kind).not.toBe('tenant');
      }
    });
  });

  it('builds clinic web addresses from APP_URL', () => {
    withEnv({ BASE_DOMAIN: 'localhost', APP_URL: 'http://localhost:3000' }, () => {
      expect(addressFor('demo')).toBe('http://demo.localhost:3000');
      expect(addressFor(null)).toBe('http://localhost:3000');
    });
  });

  it('accepts browser requests only from the address they were sent to', () => {
    withEnv({ BASE_DOMAIN: 'nextcore.net.au' }, () => {
      expect(isAllowedOrigin('https://happy-paws.nextcore.net.au', 'happy-paws.nextcore.net.au')).toBe(true);
      expect(isAllowedOrigin('https://other.nextcore.net.au', 'happy-paws.nextcore.net.au')).toBe(false);
      expect(isAllowedOrigin('https://happy-paws.nextcore.net.au', 'admin.nextcore.net.au')).toBe(false);
      expect(isAllowedOrigin('https://evil.com', 'evil.com')).toBe(false);
      expect(isAllowedOrigin('not a url', 'happy-paws.nextcore.net.au')).toBe(false);
    });
    withEnv({ BASE_DOMAIN: undefined }, () => {
      expect(isAllowedOrigin('https://nextcore.net.au', 'anything')).toBe(true);
      expect(isAllowedOrigin('https://other.nextcore.net.au', 'other.nextcore.net.au')).toBe(false);
    });
  });

  it('names clinic databases on the platform database server', () => {
    withEnv({ BASE_DOMAIN: 'nextcore.net.au' }, () => {
      expect(tenantDatabaseName('happy-paws')).toBe('vcms_t_happy_paws');
      expect(databaseUrl('vcms_t_happy_paws', { pool: 5 })).toBe('postgresql://vcms:pw@db:5432/vcms_t_happy_paws?schema=public&connection_limit=5');
      expect(() => databaseUrl('x"; DROP DATABASE vcms; --')).toThrow('Invalid database name');
    });
  });
});
