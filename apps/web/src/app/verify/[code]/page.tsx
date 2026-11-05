'use client';
import { useParams } from 'next/navigation';
import { VerifyForm, VerifyResult, VerifyShell } from '@/components/certificates/verify-view';

/** Public: the page a certificate's QR code opens. */
export default function VerifyCodePage() {
  const { code } = useParams<{ code: string }>();
  return (
    <VerifyShell>
      <div className="grid gap-6">
        <VerifyResult code={code} />
        <div className="border-t pt-4">
          <p className="mb-2 text-xs text-muted-foreground">Check another certificate</p>
          <VerifyForm initial="" />
        </div>
      </div>
    </VerifyShell>
  );
}
