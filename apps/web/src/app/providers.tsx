'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState } from 'react';
import { Toaster, toast, type ExternalToast } from 'sonner';
import { ApiError } from '@/lib/api';
import { TooltipProvider } from '@/components/ui/tooltip';

/** Long enough to read a sentence in a second language. */
const TOAST_MS = 6_000;
/** A toast with a button ("Print receipt", "Undo") stays longer so there is time to use it. */
const ACTION_TOAST_MS = 12_000;

// Sonner has one default duration for every toast; give toasts with an action button more time unless the
// caller chose a duration. Patched once on the shared `toast` object, so every screen gets the same rule.
type ToastMethod = (message: Parameters<typeof toast.success>[0], data?: ExternalToast) => string | number;
const patched = toast as typeof toast & { __actionDuration?: boolean };
if (!patched.__actionDuration) {
  patched.__actionDuration = true;
  for (const kind of ['message', 'success', 'info', 'warning', 'error'] as const) {
    const original = toast[kind] as ToastMethod;
    (toast as unknown as Record<string, ToastMethod>)[kind] = (message, data) =>
      original(message, data?.action && data.duration === undefined ? { ...data, duration: ACTION_TOAST_MS } : data);
  }
}

/** `defaultTheme`: the clinic's choice (Branding) until a staff member picks light or dark themselves. */
export function Providers({ children, defaultTheme = 'light' }: { children: React.ReactNode; defaultTheme?: 'light' | 'dark' | 'system' }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme={defaultTheme} enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster richColors closeButton position="bottom-right" duration={TOAST_MS} className="print:hidden" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
