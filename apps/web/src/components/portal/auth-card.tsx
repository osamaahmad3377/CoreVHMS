import { PawPrint } from 'lucide-react';

export function PortalAuthCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="app-canvas flex min-h-screen items-center justify-center p-4">
      <div className="surface-strong w-full max-w-sm rounded-2xl p-8">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground"><PawPrint className="h-5 w-5" /></span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Client portal</p>
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
        </div>
        {description && <p className="mb-4 text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
    </div>
  );
}
