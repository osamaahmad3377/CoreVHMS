'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Globe, Image as ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { EmptyState, ErrorState, LoadingRows } from '../page';
import { Button } from '../ui/button';
import { Input, NativeSelect } from '../ui/input';
import { api, qs } from '@/lib/api';
import { fmtBytes, fmtDateTime } from '@/lib/format';
import { usePortalEnabled } from '@/lib/session';
import type { Attachment } from '@/lib/types';

const CATEGORIES = ['photo', 'consent', 'certificate', 'report', 'lab', 'imaging', 'referral', 'correspondence', 'other'];

/** Where a related record's file lives, so its source label can link there. */
const SOURCE_HREF: Record<string, (id: string) => string> = {
  Encounter: (id) => `/consultations/${id}`,
  Admission: (id) => `/hospital/admissions/${id}`,
  Surgery: (id) => `/surgery/${id}`,
  DiagnosticOrder: (id) => `/lab/orders/${id}`,
};

/**
 * Files on a record. `includeRelated` (default for patients) also lists, read-only, the files on related
 * records the user may see — consultations, hospital stays, surgeries, lab orders — labelled with their source.
 */
export function AttachmentsPanel({ entityType, entityId, canWrite, includeRelated = entityType === 'Patient' }: { entityType: string; entityId: string; canWrite: boolean; includeRelated?: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const portal = usePortalEnabled();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const key = ['attachments', entityType, entityId];
  const list = useQuery({ queryKey: [...key, includeRelated], queryFn: () => api.get<Attachment[]>(`/attachments${qs({ entityType, entityId, includeRelated: includeRelated ? 'true' : undefined })}`) });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('entityType', entityType);
      fd.append('entityId', entityId);
      fd.append('category', category);
      if (description) fd.append('description', description);
      fd.append('file', file);
      return api.upload<Attachment>('/attachments', fd);
    },
    onSuccess: () => {
      toast.success('File uploaded');
      setDescription('');
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const share = useMutation({
    mutationFn: ({ id, shared }: { id: string; shared: boolean }) => api.patch(`/attachments/${id}/share`, { shared }),
    onSuccess: (_d, v) => {
      toast.success(v.shared ? 'Shared — the client can download it in the portal' : 'No longer shared with the client');
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/attachments/${id}`),
    onSuccess: () => {
      toast.success('File removed');
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-3">
      {canWrite && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <NativeSelect aria-label="Category" className="sm:w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </NativeSelect>
          <Input className="sm:min-w-[160px] sm:flex-1" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.dcm,video/mp4,audio/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
          <Button type="button" size="sm" onClick={() => fileRef.current?.click()} loading={upload.isPending}>
            <Upload /> Upload file
          </Button>
        </div>
      )}
      {list.isLoading ? (
        <LoadingRows rows={2} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState icon={Paperclip} title="No documents" description="Consent forms, certificates, photos and reports appear here." />
      ) : (
        <ul className="divide-y rounded-md border">
          {list.data.map((a) => {
            // Files from a related record are managed there; here they are only listed.
            const own = !a.source;
            return (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
              {a.mimeType.startsWith('image/') ? <ImageIcon className="h-4 w-4 text-muted-foreground" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <a href={`${a.url}?inline=1`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
                  {a.fileName}
                </a>
                <p className="truncate text-xs text-muted-foreground">
                  {a.category && <span className="capitalize">{a.category} · </span>}
                  {a.description && <>{a.description} · </>}
                  {fmtBytes(a.sizeBytes)} · {a.uploadedByName} · {fmtDateTime(a.createdAt)}
                </p>
                {a.source && (
                  <p className="truncate text-xs">
                    From{' '}
                    {SOURCE_HREF[a.source.entityType] ? <Link className="text-primary hover:underline" href={SOURCE_HREF[a.source.entityType](a.source.entityId)}>{a.source.label}</Link> : a.source.label}
                  </p>
                )}
              </div>
              {portal && a.sharedWithClient && <span className="rounded bg-info/10 px-1.5 py-0.5 text-2xs font-medium text-info">Shared with client</span>}
              {portal && canWrite && own && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={a.sharedWithClient ? 'Stop sharing with the client' : 'Share with the client (portal)'}
                  aria-label={a.sharedWithClient ? `Stop sharing ${a.fileName}` : `Share ${a.fileName} with client`}
                  className={a.sharedWithClient ? 'text-info' : undefined}
                  onClick={() => share.mutate({ id: a.id, shared: !a.sharedWithClient })}
                >
                  <Globe />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" asChild aria-label={`Download ${a.fileName}`}>
                <a href={a.url}>
                  <Download />
                </a>
              </Button>
              {canWrite && own && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${a.fileName}`}
                  onClick={async () => {
                    const r = await confirm({ title: 'Remove this file?', description: `${a.fileName} will be hidden from the record. The removal is recorded in the audit log.`, destructive: true, confirmLabel: 'Remove' });
                    if (r.confirmed) remove.mutate(a.id);
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
