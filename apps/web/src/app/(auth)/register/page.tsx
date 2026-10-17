'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerOrganizationSchema } from '@vcms/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Field, applyServerErrors } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { FormError } from '@/components/forms/form-error';

type Values = z.infer<typeof registerOrganizationSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(registerOrganizationSchema),
    defaultValues: { country: 'PK', organizationName: '', branchName: '', ownerName: '', email: '', password: '' },
  });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/register', values);
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        applyServerErrors(err.fieldErrors, form.setError);
        setError(err.message);
      } else setError('Registration failed');
    }
  });

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold">Create your clinic</h1>
        <p className="mt-1 text-sm text-muted-foreground">You will be the clinic owner. You can add your staff next.</p>
      </div>
      {error && <FormError message={error} />}
      <Field label="Clinic name" htmlFor="org" error={e.organizationName} required>
        <Input id="org" {...form.register('organizationName')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country" htmlFor="country" error={e.country} required>
          <NativeSelect id="country" {...form.register('country')}>
            <option value="PK">Pakistan</option>
            <option value="AU">Australia</option>
          </NativeSelect>
        </Field>
        <Field label="First branch" htmlFor="branch" error={e.branchName} required>
          <Input id="branch" placeholder="e.g. Main clinic" {...form.register('branchName')} />
        </Field>
      </div>
      <Field label="Your name" htmlFor="name" error={e.ownerName} required>
        <Input id="name" autoComplete="name" {...form.register('ownerName')} />
      </Field>
      <Field label="Email" htmlFor="email" error={e.email} required>
        <Input id="email" type="email" autoComplete="username" {...form.register('email')} />
      </Field>
      <Field label="Password" htmlFor="pw" error={e.password} hint="At least 10 characters with upper-case, lower-case and a number." required>
        <Input id="pw" type="password" autoComplete="new-password" {...form.register('password')} />
      </Field>
      <Button type="submit" loading={form.formState.isSubmitting}>Create my clinic</Button>
      <p className="text-center text-sm text-muted-foreground">
        Already registered? <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
