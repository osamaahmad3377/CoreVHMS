'use client';
import { useParams } from 'next/navigation';
import { VerifyForm, VerifyResult, VerifyShell } from '@/components/certificates/verify-view';

/** Public: the page a certificate's QR code opens. */
export default function VerifyCodePage() {
  const { code } = useParams<{ code: string }>();
  return (
    <VerifyShell>
      <div className="grid gap-5">
        <VerifyResult code={code} />
        <div className="grid gap-2 rounded-2xl surface-strong p-5 shadow-card">
          <p className="text-sm font-medium">Check another certificate</p>
          <VerifyForm />
        </div>
      </div>
    </VerifyShell>
  );
}
