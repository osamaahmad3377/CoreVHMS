import { ConfirmProvider } from '@/components/confirm';
import { PortalShell } from '@/components/portal/shell';

export default function PortalMainLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      <PortalShell>{children}</PortalShell>
    </ConfirmProvider>
  );
}
