'use client';
import { VerifyForm, VerifyShell } from '@/components/certificates/verify-view';

/** Public: type or scan a certificate's verification code. */
export default function VerifyPage() {
  return (
    <VerifyShell>
      <VerifyForm />
    </VerifyShell>
  );
}
