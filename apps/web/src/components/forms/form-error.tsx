import { AlertCircle } from 'lucide-react';
import { ApiError } from '@/lib/api';

/**
 * Error box for a form. Pass `error` (instead of, or as well as, `message`) to show the server's field
 * messages — e.g. "Temperature must be between 25 and 46 °C" — rather than only "The request contains invalid data".
 */
export function FormError({ message, error }: { message?: string | null; error?: unknown }) {
  const fields = error instanceof ApiError ? Object.values(error.fieldErrors) : [];
  const text = fields.length ? (fields.length === 1 ? fields[0] : 'Please check:') : (message ?? (error instanceof Error ? error.message : null));
  if (!text) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        {text}
        {fields.length > 1 && (
          <ul className="mt-1 list-disc pl-4">
            {fields.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
