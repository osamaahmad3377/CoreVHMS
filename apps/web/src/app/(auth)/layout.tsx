import { PawPrint, ShieldCheck, Stethoscope, Tractor } from 'lucide-react';
import { SignInFrame } from '@/components/branding/sign-in-frame';
import { hostInfo } from '@/lib/host-server';

/** Sign-in pages. On a clinic's own address they carry the clinic's branding and sign-in design (white label). */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const branding = (await hostInfo())?.clinic?.branding;
  if (branding) return <SignInFrame branding={branding}>{children}</SignInFrame>;
  return (
    <div className="app-canvas grid min-h-screen lg:grid-cols-[1fr_minmax(480px,560px)] lg:p-4">
      <div className="relative hidden flex-col justify-between overflow-hidden rounded-2xl bg-[hsl(236_40%_9%)] p-12 text-white shadow-pop lg:flex" style={{ backgroundImage: 'radial-gradient(760px 460px at 92% -8%, hsl(var(--primary) / 0.6), transparent 62%), radial-gradient(640px 420px at -8% 112%, hsl(var(--brand-2) / 0.4), transparent 62%)' }}>
        <div aria-hidden className="absolute inset-0 opacity-[0.06] [background-image:radial-gradient(hsl(0_0%_100%)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="relative flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" className="h-10 w-10 drop-shadow" />
          <span className="text-lg font-semibold tracking-tight">NextCore Veterinary</span>
        </div>
        <div className="relative max-w-lg">
          <h2 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight">One record for every animal, <span className="text-gradient [background-image:linear-gradient(120deg,#fff,hsl(var(--primary)/0.4)_160%)]">every visit, every branch.</span></h2>
          <p className="mt-3 text-white/75">
            Clinical records, scheduling, pharmacy, laboratory, billing and herd health — built for companion and farm practice in Pakistan and Australia.
          </p>
          <ul className="mt-9 grid gap-2.5 text-sm">
            {[
              [PawPrint, 'Companion animals, exotics and equine'],
              [Tractor, 'Cattle, buffalo, small ruminants and poultry'],
              [Stethoscope, 'Signed clinical records with full amendment history'],
              [ShieldCheck, 'Role-based access, MFA and complete audit trails'],
            ].map(([Icon, text]) => {
              const I = Icon as typeof PawPrint;
              return (
                <li key={text as string} className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3.5 py-2.5 ring-1 ring-inset ring-white/10 backdrop-blur">
                  <span className="rounded-lg bg-primary/25 p-1.5 text-white ring-1 ring-inset ring-white/15"><I className="h-4 w-4" /></span>
                  <span className="text-white/85">{text as string}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">© {new Date().getFullYear()} NextCore VCMS</p>
        <PawPrint aria-hidden className="absolute -bottom-16 -right-12 h-80 w-80 -rotate-12 text-white opacity-[0.045]" />
      </div>
      <div className="flex items-center justify-center p-4 sm:p-10">
        <div className="surface-strong page-enter w-full max-w-md rounded-2xl p-8 sm:p-10">{children}</div>
      </div>
    </div>
  );
}
