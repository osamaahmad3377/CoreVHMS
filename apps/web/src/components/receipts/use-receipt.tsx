'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { ReceiptDocument, copyLabels, receiptLogoUrl, type ReceiptData } from './receipt-document';
import { api } from '@/lib/api';
import { printReceipt } from '@/lib/print-receipt';
import type { ReceiptContext } from '@/lib/types';

export const RECEIPT_KEY = ['receipt-settings'] as const;

export function useReceiptContext() {
  return useQuery({ queryKey: RECEIPT_KEY, queryFn: () => api.get<ReceiptContext>('/receipt-settings'), staleTime: 60_000 });
}

/** Prints a receipt with the clinic's receipt settings (paper width, logo, copies). */
export function useReceiptPrinter() {
  const qc = useQueryClient();
  const q = useReceiptContext();
  const print = useCallback(
    /** `ctx` and `logoUrl` override the saved settings (test print of unsaved changes). */
    async (data: ReceiptData, draft?: { ctx: ReceiptContext; logoUrl: string | null }) => {
      try {
        const ctx: ReceiptContext = draft?.ctx ?? q.data ?? (await qc.fetchQuery<ReceiptContext>({ queryKey: RECEIPT_KEY, queryFn: () => api.get<ReceiptContext>('/receipt-settings') }));
        const logo = draft ? draft.logoUrl : receiptLogoUrl(ctx);
        await printReceipt(
          <>
            {copyLabels(ctx.settings.copies).map((label, i) => (
              <ReceiptDocument key={i} ctx={ctx} data={data} logoUrl={logo} copyLabel={label} />
            ))}
          </>,
          ctx.settings.paperWidthMm,
        );
      } catch (e) {
        toast.error(`Could not print the receipt: ${(e as Error).message}`);
      }
    },
    [q.data, qc],
  );
  return { ctx: q.data, print };
}

/** On-screen receipt exactly as it prints, on a paper-like background. */
export function ReceiptPreview({ data, ctx: given, logoUrl, scale = 1 }: { data: ReceiptData; ctx?: ReceiptContext; logoUrl?: string | null; scale?: number }) {
  const q = useReceiptContext();
  const ctx = given ?? q.data;
  if (!ctx) return <div className="h-64 w-[80mm] animate-pulse rounded bg-muted" aria-label="Loading receipt" />;
  return (
    <div className="mx-auto w-fit rounded-sm border bg-white shadow-md" style={{ zoom: scale }} data-testid="receipt-preview">
      <ReceiptDocument ctx={ctx} data={data} logoUrl={logoUrl !== undefined ? logoUrl : receiptLogoUrl(ctx)} />
    </div>
  );
}
