'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { ShortcutsDialog } from '../help/shortcuts';
import { WelcomeTour } from '../help/welcome-tour';
import { CommandPalette } from './command-palette';
import { RouteProgress } from './route-progress';
import { Logo, Sidebar, SidebarNav } from './sidebar';
import { Topbar } from './topbar';
import { TrialBar } from '../plan/upgrade';

const COLLAPSE_KEY = 'vcms.sidebar.collapsed';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
      if (e.key === '/' && !(e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });

  return (
    <div className="app-canvas flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[hsl(var(--shadow)/0.35)] backdrop-blur-sm lg:hidden" />
          <Dialog.Content className="surface-menu fixed inset-y-2 left-2 z-50 flex w-[min(300px,86vw)] flex-col rounded-2xl pb-[env(safe-area-inset-bottom)] [--sidebar-alpha:0.92] duration-300 ease-apple data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-left-8 data-[state=closed]:slide-out-to-left-8 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 lg:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <div className="relative flex items-center justify-center px-5 pb-3 pt-6">
              <Logo />
              <Dialog.Close className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-strong/[0.07] text-sidebar-foreground" aria-label="Close navigation">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} onSearch={() => setSearchOpen(true)} />
        <TrialBar />
        <main id="main" className="page-enter mx-auto w-full max-w-[1600px] flex-1 px-4 pb-8 pt-6 sm:px-6 lg:px-8 lg:pt-8">
          {children}
        </main>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <ShortcutsDialog />
      <WelcomeTour />
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
    </div>
  );
}
