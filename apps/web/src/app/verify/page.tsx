'use client';
import { VerifyForm, VerifyShell } from '@/components/certificates/verify-view';

/** Public: type or scan a certificate's verification code. */
export default function VerifyPage() {
  return (
    <VerifyShell>
      <div className="grid gap-4 rounded-2xl surface-strong p-6 shadow-pop sm:p-8">
        <div>
          <h1 className="text-lg font-semibold">Check a certificate</h1>
          <p className="mt-1 text-sm text-muted-foreground">Scan the QR code on the certificate with your phone, or type the verification code printed under it.</p>
        </div>
        <VerifyForm />
      </div>
    </VerifyShell>
  );
}
