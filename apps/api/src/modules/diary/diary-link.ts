import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { appUrl } from '../../common/tenancy/hosts';

type Db = PrismaService['db'];

/** The address of the owner's online diary. */
export const diaryUrl = (token: string) => `${appUrl()}/d/${token}`;

/** A long random token: the only thing that opens the page, so it is never guessable. */
export const newDiaryToken = () => randomBytes(24).toString('base64url');

/** The patient's active link, made if there is none yet (also used by automations that put the link in a message). */
export async function ensureDiaryLink(db: Db, organizationId: string, patientId: string, createdByName = 'System') {
  const have = await db.patientDiaryLink.findFirst({ where: { patientId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
  if (have) return have;
  return db.patientDiaryLink.create({ data: { organizationId, patientId, token: newDiaryToken(), createdByName } });
}
