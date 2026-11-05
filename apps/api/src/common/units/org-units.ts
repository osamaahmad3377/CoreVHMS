import { unitsOf, type Units } from '@vcms/shared';
import { RequestContext } from '../context/request-context';
import type { PrismaService } from '../prisma/prisma.service';

/** The current clinic's weight and temperature units (Settings → Clinic details), for text written by the API. */
export async function orgUnits(prisma: PrismaService): Promise<Units> {
  const id = RequestContext.get()?.organizationId;
  if (!id) return unitsOf(null);
  return unitsOf(await prisma.raw.organization.findUnique({ where: { id }, select: { weightUnit: true, temperatureUnit: true } }));
}
