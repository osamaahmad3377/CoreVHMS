#!/usr/bin/env node
// CI security gate: fails on any high or critical advisory in production dependencies, except advisories listed in
// scripts/audit-allowlist.json (each with a reason and an expiry date — an expired entry fails again, so an
// accepted risk is revisited rather than forgotten).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allow = JSON.parse(readFileSync(new URL('./audit-allowlist.json', import.meta.url), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
let raw;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  raw = e.stdout; // npm audit exits non-zero when it finds anything
}
const report = JSON.parse(raw);
if (report.error) {
  console.error('npm audit failed:', report.error.summary ?? report.error);
  process.exit(1);
}

const failures = [];
const allowed = [];
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  // Only the package's own advisories; ones it gets from a dependency are reported under that dependency.
  for (const via of v.via.filter((x) => typeof x === 'object')) {
    if (!['high', 'critical'].includes(via.severity)) continue;
    const id = via.url?.split('/').pop();
    const entry = allow.find((a) => a.advisory === id && a.package === name);
    if (entry && entry.expires >= today) allowed.push(`${name} ${id} (until ${entry.expires}): ${entry.reason}`);
    else failures.push(`${via.severity} ${name} ${id} ${via.title}${entry ? ` — allowance expired ${entry.expires}` : ''}`);
  }
}
for (const a of allowed) console.log(`Allowed: ${a}`);
const unused = allow.filter((a) => !allowed.some((x) => x.startsWith(`${a.package} ${a.advisory}`)));
for (const u of unused) console.log(`Note: ${u.package} ${u.advisory} is no longer reported — remove it from audit-allowlist.json.`);
if (failures.length) {
  console.error(`High or critical advisories in production dependencies:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('No high or critical advisories (apart from the allowed ones above).');
