# Operations runbook

Backups, restores, monitoring, secrets and incident response for a running NextCore VCMS installation.
All commands run from the repository root on the server.

For the production stack, set these once per shell (the scripts default to the development stack):

```bash
export COMPOSE_FILE=docker-compose.prod.yml DB_SERVICE=db STORAGE_SERVICE=api ENV_FILE=.env.production
```

## 1. What must be backed up

| Item | Where | Backed up by |
|---|---|---|
| Database (all clinical, financial and audit records) | `db-data` volume | `scripts/backup.sh` (`pg_dump`, custom format) |
| Uploaded files (documents, photos, lab reports) | `storage` volume | `scripts/backup.sh` (`storage.tar.gz`) |
| `.env.production` (secrets, especially `ENCRYPTION_KEY`) | server | **you** — keep a copy in the clinic's password manager, separately from the data backups |

## 2. Backups

```bash
scripts/backup.sh                         # writes backups/vcms-<UTC timestamp>/
scripts/verify-backup.sh backups/vcms-20261015T020000Z
```

Each backup folder contains `database.dump`, `storage.tar.gz`, `manifest.json` (SHA-256 checksums and sizes),
`migrations.txt` and the row count of every table taken just before and just after the dump.

`verify-backup.sh` proves the backup can be restored **without touching the live data**: it checks the
checksums, restores into a temporary database on the same server, compares every table's row count with
the counts taken at backup time, checks the migration history and the file archive, then drops the
temporary database. A corrupted file is reported as a checksum mismatch.

**Schedule** (crontab of a user in the `docker` group):

```cron
# Nightly backup at 02:00, keep 30 days (always at least the newest 7)
0 2 * * *  cd /opt/nextcore-vcms && COMPOSE_FILE=docker-compose.prod.yml DB_SERVICE=db STORAGE_SERVICE=api ENV_FILE=.env.production RETENTION_DAYS=30 scripts/backup.sh >> /var/log/vcms-backup.log 2>&1
# Weekly restore test on Sunday at 03:00 (newest backup)
0 3 * * 0  cd /opt/nextcore-vcms && COMPOSE_FILE=docker-compose.prod.yml DB_SERVICE=db STORAGE_SERVICE=api ENV_FILE=.env.production scripts/verify-backup.sh "$(ls -1d backups/vcms-* | tail -1)" >> /var/log/vcms-backup.log 2>&1
```

**Automated test of the procedure.** `scripts/test-backup-restore.sh` starts a disposable copy of the
production stack (own compose project and volumes, removed afterwards), creates a client and an uploaded file,
runs `backup.sh` and `verify-backup.sh`, checks that a corrupted backup is rejected and that `restore.sh`
refuses without `CONFIRM=restore`, changes data, restores, and checks that the database and files match the
backup. CI runs it on every change; run it on a new server before go-live (`APP_VERSION=<tag> scripts/test-backup-restore.sh`).

**Off-site copies.** Backups on the same disk do not survive a disk or server loss. Copy `backups/` to
another location every night (e.g. `rclone sync backups remote:vcms-backups` to object storage with
versioning, or `rsync` to another site). Backup folders contain personal and clinical data: store them
encrypted and restrict access.

Recommended retention: 30 daily + 12 monthly copies. Confirm the period with the clinic's record-keeping
obligations (see PRIVACY.md).

## 3. Restoring

Restoring **replaces** the live database and uploaded files. Verify the backup first.

```bash
scripts/verify-backup.sh backups/vcms-20261015T020000Z
CONFIRM=restore scripts/restore.sh backups/vcms-20261015T020000Z
```

The script checks the checksums, stops the API, drops and recreates the database, restores the dump,
replaces the uploaded files and starts the API again (which re-applies any newer migrations if you are
also running a newer image). Users must sign in again if their sessions were created after the backup.

**Restoring onto a new server:** install as in DEPLOYMENT.md with the **same `ENCRYPTION_KEY`**, start
the stack once, then run `restore.sh`.

The restore procedure was tested end to end on the production compose stack (backup → add data → restore
→ the added client and file were gone and the original file was downloadable again).

## 4. Monitoring

| What | How | Alert when |
|---|---|---|
| Availability | external uptime check of `https://<domain>/api/v1/health/ready` | not 200 for 2 minutes |
| Container health | `docker compose ps` (health checks built into the images) | any service not `healthy` |
| Errors | API logs are JSON lines: `docker compose logs api` | `"level":"error"` entries, HTTP 5xx |
| Disk | host monitoring | volume or backup disk > 80 % |
| Backups | `/var/log/vcms-backup.log` | no `✓ Backup complete` in the last 26 h, or a failed verification |
| Security | Audit log (Settings → Audit log) | bursts of `auth.login_failed` / `auth.account_locked`, unexpected role changes, exports you did not expect (filter **Exports (all)**: `client.exported`, `client.data_exported`, `client.statement_exported`, `report.exported`, `audit.exported`) |
| Messages | Communications → Message log | messages stuck in Failed |

Each HTTP request is logged with method, path (no query string), status, duration, user id and
organisation id, and a request id that is also returned in the `x-request-id` response header — quote it
when reporting a problem. Request bodies and clinical text are never logged.

Ship logs to central storage if available (`docker compose logs` can be replaced by Docker's `json-file`
rotation plus a log agent). Keep application logs for 90 days.

## 5. Secrets

| Secret | Effect of changing it |
|---|---|
| `POSTGRES_PASSWORD` | Change it in PostgreSQL (`ALTER USER vcms PASSWORD '…'`) and in `.env.production` together, then restart `api`. |
| `SESSION_SECRET` | Safe to rotate; restart `api`. (Sessions are random tokens stored as hashes, so existing sessions remain valid.) |
| `ENCRYPTION_KEY` | Encrypts users' MFA secrets. **Changing or losing it disables MFA sign-in for every user with MFA**; they would need their recovery codes and must re-enrol. Re-encryption on rotation is not implemented — keep the key safe and unchanged. |
| SMTP password | Update `.env.production`, restart `api`. |

Never commit `.env.production`; it is git-ignored.

## 6. Routine tasks

- **Staff leaving:** Settings → Staff accounts → suspend. Their sessions are revoked immediately.
- **Locked account:** after 5 failed sign-ins an account is locked for 15 minutes; the user can also reset their password by email.
- **Client asks for their data / erasure:** see PRIVACY.md §3.
- **Updates:** apply security updates monthly (DEPLOYMENT.md §5). CI runs `npm audit` and fails on any new high or critical advisory.

## 7. Incident response

1. **Contain.** Suspected account compromise: suspend the account (sessions are revoked). Suspected server
   compromise: take the reverse proxy offline (`systemctl stop caddy`) to stop access while keeping evidence.
2. **Preserve evidence.** Export the audit log (Settings → Audit log) and save `docker compose logs api > incident-api.log`.
   Audit events are append-only in the database and cannot be edited through the application.
3. **Assess.** Use the audit log to see which records were viewed, exported or changed and by whom
   (`patient.viewed`, `client.data_exported`, record changes with before/after values), and the request ids in the API log.
4. **Recover.** Rotate affected secrets (§5), reset passwords, restore data from a verified backup if records were damaged (§3).
5. **Notify.** Personal data breaches may have to be reported to affected people and regulators
   (e.g. the Notifiable Data Breaches scheme in Australia). Record what happened, when, the data affected and actions taken. See PRIVACY.md.
6. **Review.** Write down the cause and the fix; add a test where the cause was a software defect.
