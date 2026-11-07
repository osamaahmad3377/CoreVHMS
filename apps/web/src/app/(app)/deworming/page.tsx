'use client';
import { Bug, Plus } from 'lucide-react';
import { Suspense, useState } from 'react';
import { PageHeader } from '@/components/page';
import { AddVaccinationDialog } from '@/components/preventive/add-vaccination-dialog';
import { Protocols, Worklist } from '@/components/preventive/protocols';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { tabListClass, tabTriggerClass } from '@/components/ui/tabs';
import { useUrlState } from '@/hooks/use-url-state';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/**
 * Deworming in one place: the clinic's own dewormers (each with its product from stock, the species it is for and
 * how often it is repeated — approved by a vet), and the animals due or overdue for deworming.
 */
function Deworming() {
  const url = useUrlState();
  const { can } = useSession();
  const tab = url.get('tab', 'due');
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title="Deworming"
        description="Your clinic’s dewormers and the animals due for deworming. Owners get the usual reminders."
        actions={
          can('preventive.write') && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add patient for deworming
            </Button>
          )
        }
      />
      <AddVaccinationDialog open={adding} onOpenChange={setAdding} kind="DEWORMING" />
      <div className={cn(tabListClass, 'mb-6')} role="tablist">
        {[
          ['due', 'Due & overdue'],
          ['dewormers', 'Dewormers'],
        ].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => url.set({ tab: k })} className={tabTriggerClass()}>
            {k === 'dewormers' && <Bug className="h-4 w-4" />} {l}
          </button>
        ))}
      </div>
      {tab === 'dewormers' ? <Protocols kind="DEWORMING" /> : <Worklist kind="DEWORMING" />}
    </>
  );
}

export default function DewormingPage() {
  return (
    <RequirePermission anyOf={['preventive.read']}>
      <Suspense>
        <Deworming />
      </Suspense>
    </RequirePermission>
  );
}
