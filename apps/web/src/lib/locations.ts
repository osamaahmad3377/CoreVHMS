import type { StockLocation } from './types';

/**
 * The stock location to pre-select: the current branch's default location, then any active location of that
 * branch, then any active default, then anything. Picking another branch's default would silently put a delivery
 * (or a return, or an order) on the wrong branch's stock.
 */
export function defaultLocation(locations: StockLocation[] | undefined, branchId: string | undefined): StockLocation | undefined {
  const all = locations ?? [];
  const active = all.filter((l) => l.isActive);
  const here = active.filter((l) => l.branchId === branchId);
  return here.find((l) => l.isDefault) ?? here[0] ?? active.find((l) => l.isDefault) ?? active[0] ?? all[0];
}

/** Location name, with its branch when the clinic has stock locations in more than one branch. */
export function locationLabel(l: StockLocation, all: StockLocation[] | undefined) {
  const branches = new Set((all ?? []).map((x) => x.branchId));
  return branches.size > 1 && l.branch?.name ? `${l.name} · ${l.branch.name}` : l.name;
}

/** Locations for a picker: the current branch's first. */
export function sortedLocations(all: StockLocation[] | undefined, branchId: string | undefined) {
  return [...(all ?? [])].sort((a, b) => Number(b.branchId === branchId) - Number(a.branchId === branchId));
}
