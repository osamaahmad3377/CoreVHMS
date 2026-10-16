import { PawPrint, ShieldCheck, Stethoscope, Tractor } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(480px,560px)]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-white lg:flex">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight">NextCore Veterinary</span>
        </div>
        <div className="max-w-lg">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">One record for every animal, every visit, every branch.</h2>
          <p className="mt-3 text-sidebar-foreground">
            Clinical records, scheduling, pharmacy, laboratory, billing and herd health — built for companion and farm practice in Pakistan and Australia.
          </p>
          <ul className="mt-8 grid gap-3 text-sm text-sidebar-foreground">
            <li className="flex items-center gap-3"><PawPrint className="h-4 w-4 text-primary" /> Companion animals, exotics and equine</li>
            <li className="flex items-center gap-3"><Tractor className="h-4 w-4 text-primary" /> Cattle, buffalo, small ruminants and poultry</li>
            <li className="flex items-center gap-3"><Stethoscope className="h-4 w-4 text-primary" /> Signed clinical records with full amendment history</li>
            <li className="flex items-center gap-3"><ShieldCheck className="h-4 w-4 text-primary" /> Role-based access, MFA and complete audit trails</li>
          </ul>
        </div>
        <p className="text-xs text-sidebar-foreground/60">© {new Date().getFullYear()} NextCore VCMS</p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
      </div>
      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
