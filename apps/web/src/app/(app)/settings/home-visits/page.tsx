'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { useHomeVisitSettings } from '@/components/scheduling/home-visit-fields';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { HomeVisitSettings, Service } from '@/lib/types';

function Form() {
  const { currency } = useSession();
  const qc = useQueryClient();
  const settings = useHomeVisitSettings();
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services') });
  const [callout, setCallout] = useState('');
  const [perKm, setPerKm] = useState('');
  const [travel, setTravel] = useState('30');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!settings.data) return;
    setCallout(settings.data.callout?.id ?? '');
    setPerKm(settings.data.perKm?.id ?? '');
    setTravel(String(settings.data.travelMinutes));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api.put<HomeVisitSettings>('/home-visits/settings', { calloutServiceId: callout || null, perKmServiceId: perKm || null, travelMinutes: Number(travel) }),
    onSuccess: (s) => {
      qc.setQueryData(['home-visit-settings'], s);
      toast.success('Home visit settings saved');
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (settings.isLoading || services.isLoading) return <LoadingRows rows={3} />;
  const active = (services.data ?? []).filter((s) => s.isActive);
  const options = active.map((s) => (
    <option key={s.id} value={s.id}>
      {s.name} · {fmtMoney(s.priceMinor, currency)}
    </option>
  ));
  const travelNum = Number(travel);
  const travelOk = travel !== '' && Number.isInteger(travelNum) && travelNum >= 0 && travelNum <= 240;

  return (
    <Card className="grid gap-4 p-4">
      {error && <FormError message={error} />}
      <Field label="Call-out fee" htmlFor="hv-callout" hint="Added to the client’s bill once per home visit, when the vet arrives.">
        <NativeSelect id="hv-callout" value={callout} onChange={(e) => setCallout(e.target.value)}>
          <option value="">No call-out fee</option>
          {options}
        </NativeSelect>
      </Field>
      <Field label="Price per km" htmlFor="hv-km" hint="The service’s price is charged for each km travelled (the vet records the distance). Leave empty for no travel charge.">
        <NativeSelect id="hv-km" value={perKm} onChange={(e) => setPerKm(e.target.value)}>
          <option value="">No charge per km</option>
          {options}
        </NativeSelect>
      </Field>
      <Field label="Usual travel time (minutes)" htmlFor="hv-travel" hint="Blocked on the vet’s calendar before each home visit. Can be changed on each booking." error={travelOk ? undefined : 'Enter 0 to 240 minutes'}>
        <Input id="hv-travel" type="number" min={0} max={240} step={5} className="w-32" value={travel} onChange={(e) => setTravel(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">
        Fees come from your price list. To add or change a price, open{' '}
        <Link href="/settings/services" className="text-primary hover:underline">
          Services & prices
        </Link>{' '}
        (for example “Home visit call-out” and “Travel per km”).
      </p>
      <div className="flex justify-end">
        <Button disabled={!travelOk} loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Card>
  );
}

export default function HomeVisitSettingsPage() {
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <div className="grid gap-4">
        <div>
          <h2 className="text-base font-semibold">Home visits</h2>
          <p className="text-sm text-muted-foreground">What a home visit costs the client, and how much time the vet needs to get there.</p>
        </div>
        <Form />
      </div>
    </RequirePermission>
  );
}
