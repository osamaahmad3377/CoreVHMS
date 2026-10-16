import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 32 bytes hex'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).default(480),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).default(168),
  // Secure cookies and closed self-registration by default in production.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default(process.env.NODE_ENV === 'production' ? 'true' : 'false')
    .transform((v) => v === 'true'),
  ALLOW_SIGNUP: z
    .enum(['true', 'false'])
    .default(process.env.NODE_ENV === 'production' ? 'false' : 'true')
    .transform((v) => v === 'true'),
  /** Express "trust proxy" setting: 'loopback' (default), a hop count such as '1' behind one reverse proxy, or 'false'. */
  TRUST_PROXY: z.string().default('loopback'),
  /** Swagger UI at /api/docs. Off by default in production. */
  API_DOCS: z
    .enum(['true', 'false'])
    .default(process.env.NODE_ENV === 'production' ? 'false' : 'true')
    .transform((v) => v === 'true'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default(process.env.NODE_ENV === 'production' ? 'json' : 'pretty'),
  LOG_REQUESTS: z
    .enum(['true', 'false'])
    .default(process.env.NODE_ENV === 'test' ? 'false' : 'true')
    .transform((v) => v === 'true'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('NextCore VCMS <no-reply@nextcore.local>'),
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  // Client portal (client-facing website). Off until the clinic is ready to offer it.
  CLIENT_PORTAL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(20),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const problems = productionProblems(parsed.data);
  if (problems.length) throw new Error(`Refusing to start in production:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  cached = parsed.data;
  return cached;
}

/** Settings that are acceptable for development but unsafe for a production deployment. */
export function productionProblems(e: Env): string[] {
  if (e.NODE_ENV !== 'production') return [];
  const out: string[] = [];
  const weak = /change|example|secret|password|dev|test|12345/i;
  if (weak.test(e.SESSION_SECRET) || new Set(e.SESSION_SECRET).size < 12) out.push('SESSION_SECRET looks like a placeholder; generate one with `openssl rand -hex 32`');
  if (/^0+$|^(0123456789abcdef)+$/i.test(e.ENCRYPTION_KEY)) out.push('ENCRYPTION_KEY looks like a placeholder; generate one with `openssl rand -hex 32`');
  if (/dev_password|vcms:vcms@/.test(e.DATABASE_URL)) out.push('DATABASE_URL uses the development database password');
  if (!e.COOKIE_SECURE && process.env.ALLOW_INSECURE_COOKIES !== 'true') out.push('COOKIE_SECURE must be true behind HTTPS (set ALLOW_INSECURE_COOKIES=true only for a local trial without TLS)');
  return out;
}

/** Test helper: forget cached values after mutating process.env. */
export function resetEnvCache() {
  cached = null;
}
