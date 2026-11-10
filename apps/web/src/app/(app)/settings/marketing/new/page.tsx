'use client';
import { Suspense } from 'react';
import { CampaignBuilder } from '@/components/automations/campaign-builder';
import { FeatureLockedPage, usePlanFeature } from '@/components/plan/upgrade';
import { RequirePermission } from '@/components/require';

function Gate() {
  const marketingOk = usePlanFeature('marketing');
  if (!marketingOk) return <FeatureLockedPage feature="marketing" />;
  return <CampaignBuilder />;
}

export default function NewCampaignPage() {
  return (
    <RequirePermission anyOf={['settings.manage', 'integrations.manage']}>
      <Suspense>
        <Gate />
      </Suspense>
    </RequirePermission>
  );
}
