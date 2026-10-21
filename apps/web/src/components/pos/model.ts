import { calcLine, sumLines } from '@vcms/shared';
import type { Charge, PosItem } from '@/lib/types';

/** A catalogue item, or an "other item" typed in at the counter (name and price only). */
export type CartItem = Omit<PosItem, 'type'> & { type: PosItem['type'] | 'CUSTOM' | 'CHARGE' };

/**
 * Medicine already handed out against a prescription: its charge is waiting under "Not yet invoiced" and is
 * added to this sale as it is (quantity and price are fixed by what was dispensed).
 */
export function chargeItem(c: Pick<Charge, 'id' | 'description' | 'unitPriceMinor' | 'taxRateBasisPoints'>): CartItem {
  return {
    type: 'CHARGE', id: c.id, name: c.description, code: null, barcode: null, category: 'MEDICINE', categoryId: null, categoryName: null,
    brand: null, packSize: null, photoAttachmentId: null, unit: 'item', priceMinor: c.unitPriceMinor, taxRateBasisPoints: c.taxRateBasisPoints, trackStock: false, available: null, rxOnly: false, controlled: false,
  };
}

/** Builds an "other item" for the basket; it is sold as a CUSTOM invoice line at the price typed in. */
export function customItem(name: string, priceMinor: number, taxRateBasisPoints: number): CartItem {
  return {
    type: 'CUSTOM', id: crypto.randomUUID(), name, code: null, barcode: null, category: 'CUSTOM', categoryId: null, categoryName: null,
    brand: null, packSize: null, photoAttachmentId: null, unit: 'item', priceMinor, taxRateBasisPoints, trackStock: false, available: null, rxOnly: false, controlled: false,
  };
}

export interface CartLine {
  key: string;
  item: CartItem;
  quantity: number;
  /** Unit price charged; differs from the catalogue price only after an authorised override. */
  priceMinor: number;
  discountMinor: number;
  /** Who approved selling a prescription-only item without a prescription. */
  rxNote?: string;
}

export interface Tender {
  /** Also used as the payment idempotency key, so a retried request cannot take the payment twice. */
  key: string;
  method: string;
  amountMinor: number;
  reference: string;
}

/** Shop-counter sections: shop items first, then clinic items. */
export const CATEGORIES = [
  { key: '', label: 'All' },
  { key: 'SERVICE', label: 'Services' },
  { key: 'FOOD', label: 'Food & treats' },
  { key: 'GROOMING', label: 'Grooming & hygiene' },
  { key: 'ACCESSORY', label: 'Accessories' },
  { key: 'SUPPLEMENT', label: 'Supplements' },
  { key: 'RETAIL', label: 'Other shop items' },
  { key: 'CONSUMABLE', label: 'Consumables' },
  { key: 'EQUIPMENT', label: 'Equipment' },
  { key: 'MEDICINE', label: 'Medicines' },
  { key: 'VACCINE', label: 'Vaccines' },
] as const;

export function lineAmounts(l: CartLine, inclusive: boolean) {
  return calcLine({ quantity: l.quantity, unitPriceMinor: l.priceMinor, discountMinor: Math.min(l.discountMinor, Math.round(l.quantity * l.priceMinor)), taxRateBasisPoints: l.item.taxRateBasisPoints }, inclusive);
}

export function cartTotals(lines: CartLine[], inclusive: boolean) {
  return sumLines(lines.map((l) => ({ ...lineAmounts(l, inclusive), discountMinor: l.discountMinor })));
}

/** Why an item cannot be added (or more of it), or null if it can. */
export function blockReason(item: CartItem, qtyInCart: number, allowNegative: boolean, allowRx = false): string | null {
  if (item.rxOnly && item.controlled) return 'Controlled medicine — needs a prescription (use “Collect a prescription”)';
  if (item.rxOnly && !allowRx) return 'Prescription only — use “Collect a prescription”';
  if (item.priceMinor === null) return 'No price set';
  if (item.trackStock && !allowNegative && item.available !== null && qtyInCart >= item.available) return item.available <= 0 ? 'Out of stock' : 'No more in stock';
  return null;
}

/** Out of stock (nothing left at all), as opposed to having reached the last one in the basket. */
export const isOutOfStock = (item: CartItem, allowNegative: boolean) => item.trackStock && !allowNegative && item.available !== null && item.available <= 0;

/** The waiting charges (medicines handed out against prescriptions) in the basket, invoiced with the sale. */
export const toChargeIds = (lines: CartLine[]) => lines.filter((l) => l.item.type === 'CHARGE').map((l) => l.item.id);

export function toInvoiceLines(lines: CartLine[]) {
  return lines.filter((l) => l.item.type !== 'CHARGE').map((l) => {
    if (l.item.type === 'CUSTOM') return { kind: 'CUSTOM' as const, description: l.item.name, quantity: l.quantity, unitPriceMinor: l.priceMinor, discountMinor: l.discountMinor };
    return {
      kind: l.item.type,
      productId: l.item.type === 'PRODUCT' ? l.item.id : undefined,
      serviceId: l.item.type === 'SERVICE' ? l.item.id : undefined,
      quantity: l.quantity,
      unitPriceMinor: l.priceMinor !== l.item.priceMinor ? l.priceMinor : undefined,
      discountMinor: l.discountMinor,
      withoutPrescriptionNote: l.rxNote,
    };
  });
}

/** Quick-cash suggestions: exact amount plus the next round notes above it. */
export function quickCash(dueMinor: number, currency: string) {
  const notes = currency === 'PKR' ? [10000, 50000, 100000, 500000] : [500, 1000, 2000, 5000, 10000];
  const out = new Set<number>([dueMinor]);
  for (const n of notes) out.add(Math.ceil(dueMinor / n) * n);
  return [...out].filter((v) => v > 0).sort((a, b) => a - b).slice(0, 5);
}
