'use client';
import {
  BORDER_STYLES,
  CERTIFICATE_KIND_INFO,
  CERTIFICATE_STYLES,
  CERTIFICATE_STYLE_LABELS,
  PAGE_SIZES,
  SAMPLE_VACCINATIONS,
  certificateFields,
  certificateLayoutSchema,
  defaultCertificateLayout,
  pageMm,
  sampleCertificateData,
  type CertificateElement,
  type CertificateKind,
  type CertificateLayout,
} from '@vcms/shared';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Barcode as BarcodeIcon,
  Bold,
  Braces,
  Copy,
  Eye,
  EyeOff,
  Heading,
  Image as ImageIcon,
  Italic,
  LayoutTemplate,
  Minus,
  PenLine,
  QrCode,
  Redo2,
  Square,
  Stamp,
  Table2,
  Trash2,
  Type,
  Undo2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { CertificatePage, ElementView, MM_TO_PX, placeStyle, sampleData } from './certificate-page';

type El = CertificateElement;
type Patch = Partial<El>;
/** Omit applied to each kind of element separately. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewEl = DistOmit<El, 'id' | 'x' | 'y'> & { x?: number; y?: number };
const round = (n: number, step = 0.5) => Math.round(n / step) * step;
const newId = () => `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/** Reads an image file as a data URL, scaled down so the template stays small. */
async function imageFile(file: File, maxPx = 1000): Promise<string> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error('Choose a PNG, JPG, WebP or SVG image');
  const raw = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('Could not read the image'));
    r.readAsDataURL(file);
  });
  if (file.type === 'image/svg+xml') {
    if (raw.length > 650_000) throw new Error('That image is too large — keep it under 500 KB');
    return raw;
  }
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not read the image'));
    i.src = raw;
  });
  const k = Math.min(1, maxPx / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  let out = c.toDataURL('image/png');
  if (out.length > 650_000) out = c.toDataURL('image/jpeg', 0.85);
  if (out.length > 650_000) throw new Error('That image is too large — use a smaller one');
  return out;
}

function Num({ label, value, onChange, step = 0.5, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="grid gap-1 text-2xs text-muted-foreground">
      {label}
      <Input type="number" className="h-8" step={step} min={min} max={max} value={Number.isFinite(value) ? Math.round(value * 100) / 100 : ''} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
    </label>
  );
}

/** "#1a2b3c" from what was typed: with or without "#", and short codes like "#f00". Null while incomplete. */
export function parseHex(raw: string): string | null {
  const v = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${[...v].map((c) => c + c).join('').toLowerCase()}`;
  return null;
}

/**
 * A colour: the swatch opens the picker, and the code can be typed. What is typed stays in the box while it is being
 * typed and is applied as soon as it is a complete colour; leaving the box with an unfinished code puts back the colour
 * in use.
 */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  // Follow changes made elsewhere (the picker, undo, another element).
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="grid gap-1 text-2xs text-muted-foreground">
      {label}
      <span className="flex items-center gap-1.5">
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-9 shrink-0 cursor-pointer rounded border bg-transparent p-0.5" />
        <Input
          aria-label={`${label} code`}
          className="h-8 font-mono text-xs"
          value={draft}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            const hex = e.target.value.replace(/^#/, '').length === 6 ? parseHex(e.target.value) : null;
            if (hex && hex !== value) onChange(hex);
          }}
          onBlur={() => {
            const hex = parseHex(draft);
            if (hex && hex !== value) onChange(hex);
            setDraft(hex ?? value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </span>
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b p-3 last:border-0">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

const ICON: Record<El['type'], React.ComponentType<{ className?: string }>> = { text: Type, image: ImageIcon, qr: QrCode, barcode: BarcodeIcon, line: Minus, box: Square, table: Table2, signature: PenLine, watermark: Stamp };
const NAME: Record<El['type'], string> = { text: 'Text', image: 'Image', qr: 'QR code', barcode: 'Barcode', line: 'Line', box: 'Box / frame', table: 'Vaccinations table', signature: 'Signature', watermark: 'Watermark' };

/**
 * Drag-and-drop certificate designer. Elements are positioned in millimetres on a true-size page (scaled to fit the
 * screen); drag to move, drag the corner to resize, arrow keys to nudge (Shift: 5 mm), Delete to remove,
 * Ctrl/⌘+Z to undo, Ctrl/⌘+D to duplicate.
 */
export function TemplateDesigner({
  kind,
  layout: initial,
  name: initialName,
  saving,
  onSave,
  extraActions,
}: {
  kind: CertificateKind;
  layout: CertificateLayout;
  name: string;
  saving: boolean;
  onSave: (v: { name: string; layout: CertificateLayout }) => void;
  extraActions?: React.ReactNode;
}) {
  const { session } = useSession();
  const confirm = useConfirm();
  const info = CERTIFICATE_KIND_INFO[kind];
  const [layout, setLayout] = useState<CertificateLayout>(initial);
  const [name, setName] = useState(initialName);
  const [selected, setSelected] = useState<string | null>(null);
  const [showSample, setShowSample] = useState(true);
  const [past, setPast] = useState<CertificateLayout[]>([]);
  const [future, setFuture] = useState<CertificateLayout[]>([]);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const [saved, setSaved] = useState(JSON.stringify({ name: initialName, layout: initial }));
  const dirty = JSON.stringify({ name, layout }) !== saved;

  const fields = useMemo(() => certificateFields(kind), [kind]);
  const sample = useMemo(() => sampleCertificateData(kind), [kind]);
  const placeholderData = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, `{{${f.key}}}`])), [fields]);
  const data = sampleData(showSample ? sample : placeholderData, SAMPLE_VACCINATIONS, session.organization?.logoUrl ?? null);
  const page = pageMm(layout.page);
  const sel = layout.elements.find((e) => e.id === selected) ?? null;

  // History: every change goes through commit(); drags push one step when they start.
  const commit = useCallback((next: CertificateLayout | ((l: CertificateLayout) => CertificateLayout), record = true) => {
    setLayout((cur) => {
      const n = typeof next === 'function' ? next(cur) : next;
      if (record) {
        setPast((p) => [...p.slice(-49), cur]);
        setFuture([]);
      }
      return n;
    });
  }, []);
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [layout, ...f]);
    setLayout(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, layout]);
    setLayout(future[0]);
    setFuture((f) => f.slice(1));
  };
  const update = (id: string, patch: Patch, record = true) => commit((l) => ({ ...l, elements: l.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as El) : e)) }), record);
  const setPage = (patch: Partial<CertificateLayout['page']>) => commit((l) => ({ ...l, page: { ...l.page, ...patch } }));
  const add = (el: NewEl) => {
    const e = { x: round(page.w / 2 - el.w / 2), y: round(page.h / 2 - el.h / 2), ...el, id: newId() } as El;
    commit((l) => ({ ...l, elements: [...l.elements, e] }));
    setSelected(e.id);
  };
  const remove = (id: string) => {
    commit((l) => ({ ...l, elements: l.elements.filter((e) => e.id !== id) }));
    setSelected(null);
  };
  const duplicate = (id: string) => {
    const e = layout.elements.find((x) => x.id === id);
    if (!e) return;
    const copy = { ...e, id: newId(), x: e.x + 4, y: e.y + 4 } as El;
    commit((l) => ({ ...l, elements: [...l.elements, copy] }));
    setSelected(copy.id);
  };
  const layer = (id: string, dir: 'up' | 'down') =>
    commit((l) => {
      const els = l.elements.filter((e) => e.id !== id);
      const e = l.elements.find((x) => x.id === id)!;
      return { ...l, elements: dir === 'up' ? [...els, e] : [e, ...els] };
    });

  // ── Fit the page to the canvas area ──
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    if (!area) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.max(0.25, Math.min(1.3, (e.contentRect.width - 32) / (page.w * MM_TO_PX)))));
    ro.observe(area);
    return () => ro.disconnect();
  }, [area, page.w]);
  const pxPerMm = scale * MM_TO_PX;

  // ── Dragging and resizing ──
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  const startDrag = (e: React.PointerEvent, el: El, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(el.id);
    setPast((p) => [...p.slice(-49), layout]);
    setFuture([]);
    drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h };
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.sx) / pxPerMm;
      const dy = (e.clientY - d.sy) / pxPerMm;
      const free = e.altKey;
      if (d.mode === 'move') {
        let x = free ? d.ox + dx : round(d.ox + dx);
        let y = free ? d.oy + dy : round(d.oy + dy);
        // Snap the element's centre to the page's centre lines.
        const v = Math.abs(x + d.ow / 2 - page.w / 2) < 1.5;
        const h = Math.abs(y + d.oh / 2 - page.h / 2) < 1.5;
        if (v) x = page.w / 2 - d.ow / 2;
        if (h) y = page.h / 2 - d.oh / 2;
        setGuides({ v, h });
        x = Math.max(-d.ow + 2, Math.min(page.w - 2, x));
        y = Math.max(-d.oh + 2, Math.min(page.h - 2, y));
        update(d.id, { x, y }, false);
      } else {
        const w = Math.max(2, free ? d.ow + dx : round(d.ow + dx));
        const hgt = Math.max(0.5, free ? d.oh + dy : round(d.oh + dy));
        update(d.id, { w, h: hgt }, false);
      }
    };
    const up = () => {
      drag.current = null;
      setGuides({ v: false, h: false });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerMm, page.w, page.h]);

  // ── Keyboard ──
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest('input, textarea, select, [contenteditable="true"]');
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (typing || !sel) return;
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate(sel.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(sel.id);
      } else if (e.key === 'Escape') {
        setSelected(null);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        update(sel.id, { x: sel.x + dx, y: sel.y + dy });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // ── Saving ──
  const save = () => {
    const parsed = certificateLayoutSchema.safeParse(layout);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      toast.error(`Can’t save yet: ${issue.message}${issue.path.length ? ` (${issue.path.join(' › ')})` : ''}`);
      return;
    }
    if (name.trim().length < 2) {
      toast.error('Name the template');
      return;
    }
    onSave({ name: name.trim(), layout: parsed.data });
    setSaved(JSON.stringify({ name: name.trim(), layout: parsed.data }));
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const startFrom = async (style: (typeof CERTIFICATE_STYLES)[number]) => {
    const r = await confirm({ title: `Start again from the ${CERTIFICATE_STYLE_LABELS[style]} design?`, description: 'Your current design is replaced. You can undo this.', confirmLabel: 'Use this design' });
    if (!r.confirmed) return;
    commit(defaultCertificateLayout(kind, style, layout.page.size));
    setSelected(null);
  };

  const upload = async (file: File | undefined, then: (src: string) => void) => {
    if (!file) return;
    try {
      then(await imageFile(file));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const textDefaults = { type: 'text' as const, fontFamily: 'sans' as const, fontWeight: 400 as const, align: 'left' as const, color: '#1f2937', lineHeight: 1.4 };
  const detailsText =
    info.subject === 'PATIENT'
      ? 'Name: {{patient.name}}\nSpecies / breed: {{patient.species}} — {{patient.breed}}\nSex: {{patient.sex}}    Born: {{patient.dateOfBirth}}\nMicrochip: {{patient.microchip}}\nOwner: {{owner.name}}'
      : 'Name: {{staff.name}}\nJob title: {{staff.jobTitle}}\nJoined: {{staff.joinedAt}}\nRegistration: {{staff.registration}}';

  const palette: { label: string; icon: React.ComponentType<{ className?: string }>; make: () => void }[] = [
    { label: 'Heading', icon: Heading, make: () => add({ ...textDefaults, w: 140, h: 14, text: '{{certificate.title}}', fontSize: 24, fontWeight: 700, fontFamily: 'serif', align: 'center' }) },
    { label: 'Text', icon: Type, make: () => add({ ...textDefaults, w: 120, h: 12, text: 'Your text', fontSize: 11 }) },
    { label: 'Wording', icon: AlignJustify, make: () => add({ ...textDefaults, w: 160, h: 26, text: '{{certificate.statement}}', fontSize: 11.5, align: 'justify', lineHeight: 1.6 }) },
    { label: 'Details', icon: Braces, make: () => add({ ...textDefaults, w: 120, h: 30, text: detailsText, fontSize: 9.5, lineHeight: 1.65 }) },
    { label: 'Logo', icon: ImageIcon, make: () => add({ type: 'image', src: 'logo', fit: 'contain', w: 28, h: 20 }) },
    { label: 'QR code', icon: QrCode, make: () => add({ type: 'qr', color: '#111827', w: 24, h: 24 }) },
    { label: 'Barcode', icon: BarcodeIcon, make: () => add({ type: 'barcode', color: '#111827', showText: true, w: 50, h: 12 }) },
    { label: 'Signature', icon: PenLine, make: () => add({ type: 'signature', label: info.subject === 'STAFF' ? 'For {{clinic.name}}' : 'Veterinarian', color: '#1f2937', showName: true, fontSize: 9, w: 70, h: 22 }) },
    ...(info.subject === 'PATIENT' ? [{ label: 'Vaccinations', icon: Table2, make: () => add({ type: 'table', source: 'VACCINATIONS', fontSize: 8.5, headerColor: '#1e3a5f', color: '#1f2937', w: page.w - 44, h: 50 }) }] : []),
    {
      label: 'Watermark',
      icon: Stamp,
      make: () => {
        const w = Math.min(page.w - 20, 170);
        add({ type: 'watermark', mode: 'text', text: 'ORIGINAL', src: 'logo', fontSize: 72, fontFamily: 'sans', fontWeight: 700, color: '#6b7280', opacity: 0.12, letterSpacing: 4, rotate: -30, w, h: 60, x: round((page.w - w) / 2), y: round(page.h / 2 - 30) });
      },
    },
    { label: 'Line', icon: Minus, make: () => add({ type: 'line', color: '#8a6d3b', thickness: 0.4, style: 'solid', w: 80, h: 1 }) },
    { label: 'Box / frame', icon: Square, make: () => add({ type: 'box', borderColor: '#8a6d3b', borderWidth: 0.5, borderStyle: 'solid', fill: 'transparent', radius: 2, w: 80, h: 40 }) },
  ];

  const imageInput = useRef<HTMLInputElement>(null);
  const bgInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  return (
    <div className="grid min-w-0 gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl surface-flat p-2">
        <Input aria-label="Template name" className="h-9 w-full min-w-0 sm:w-64" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        <span className="hidden text-xs text-muted-foreground lg:inline">{info.label}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" disabled={!past.length} onClick={undo} title="Undo (Ctrl/⌘+Z)" aria-label="Undo"><Undo2 /></Button>
          <Button size="sm" variant="ghost" disabled={!future.length} onClick={redo} title="Redo (Ctrl/⌘+Shift+Z)" aria-label="Redo"><Redo2 /></Button>
          <Button size="sm" variant="outline" onClick={() => setShowSample((v) => !v)} title={showSample ? 'Show the fields instead of sample data' : 'Show sample data'}>
            {showSample ? <EyeOff /> : <Eye />} {showSample ? 'Show fields' : 'Sample data'}
          </Button>
          {extraActions}
          <Button size="sm" disabled={!dirty} loading={saving} onClick={save}>{dirty ? 'Save template' : 'Saved'}</Button>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[176px_minmax(0,1fr)_280px]">
        {/* Palette */}
        <div className="grid h-fit gap-3 rounded-xl surface-flat p-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Add to the page</p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-2">
            {palette.map((p) => (
              <button key={p.label} type="button" onClick={p.make} className="flex flex-col items-center gap-1 rounded-lg border border-foreground/10 bg-card p-2 text-2xs font-medium transition-colors hover:border-primary/40 hover:bg-primary/5">
                <p.icon className="h-4 w-4 text-primary" />
                {p.label}
              </button>
            ))}
            <button type="button" onClick={() => imageInput.current?.click()} className="flex flex-col items-center gap-1 rounded-lg border border-foreground/10 bg-card p-2 text-2xs font-medium transition-colors hover:border-primary/40 hover:bg-primary/5">
              <Upload className="h-4 w-4 text-primary" />
              Image
            </button>
          </div>
          <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => upload(e.target.files?.[0], (src) => add({ type: 'image', src, fit: 'contain', w: 40, h: 25 }))} />
          <label className="grid gap-1 text-2xs text-muted-foreground">
            Add a field
            <NativeSelect
              className="h-8 text-xs"
              value=""
              onChange={(e) => {
                const f = fields.find((x) => x.key === e.target.value);
                if (f) add({ ...textDefaults, w: 80, h: 8, text: `{{${f.key}}}`, fontSize: 11 });
              }}
            >
              <option value="">Choose…</option>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </NativeSelect>
          </label>
          <div className="grid gap-1.5 border-t pt-3">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Start from a design</p>
            {CERTIFICATE_STYLES.map((s) => (
              <Button key={s} size="sm" variant="outline" className="justify-start" onClick={() => startFrom(s)}>
                <LayoutTemplate /> {CERTIFICATE_STYLE_LABELS[s]}
              </Button>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div ref={setArea} className="min-w-0 overflow-auto rounded-xl bg-muted/50 p-4" onPointerDown={() => setSelected(null)}>
          <div className="relative mx-auto shadow-lg ring-1 ring-black/10" style={{ width: page.w * pxPerMm, height: page.h * pxPerMm }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${page.w}mm` }}>
              <CertificatePage
                layout={layout}
                data={data}
                renderElement={(el) => {
                  const on = el.id === selected;
                  return (
                    <div
                      key={el.id}
                      role="button"
                      tabIndex={-1}
                      aria-label={NAME[el.type]}
                      onPointerDown={(e) => startDrag(e, el, 'move')}
                      style={{ ...placeStyle(el), cursor: 'move', touchAction: 'none' }}
                      className={cn('group select-none', on ? 'outline outline-2 outline-offset-1 outline-primary' : 'hover:outline hover:outline-1 hover:outline-primary/50')}
                    >
                      <div className="pointer-events-none h-full w-full">
                        <ElementView el={el} data={data} designer />
                      </div>
                      {on && (
                        <div
                          onPointerDown={(e) => startDrag(e, el, 'resize')}
                          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border-2 border-white bg-primary shadow"
                          style={{ transform: `scale(${1 / scale})`, transformOrigin: 'bottom right', touchAction: 'none' }}
                          aria-label="Resize"
                        />
                      )}
                    </div>
                  );
                }}
              >
                {guides.v && <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-pink-500" style={{ left: `${page.w / 2}mm` }} />}
                {guides.h && <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-pink-500" style={{ top: `${page.h / 2}mm` }} />}
              </CertificatePage>
            </div>
          </div>
          <p className="mt-3 text-center text-2xs text-muted-foreground">
            Drag to move · drag the corner to resize · arrow keys nudge (Shift: 5 mm) · hold Alt to place freely · Delete removes · Ctrl/⌘+D duplicates
          </p>
        </div>

        {/* Properties */}
        <div className="h-fit min-w-0 rounded-xl surface-flat">
          {sel ? (
            <>
              <div className="flex items-center gap-2 border-b p-3">
                {(() => {
                  const I = ICON[sel.type];
                  return <I className="h-4 w-4 text-primary" />;
                })()}
                <span className="text-sm font-semibold">{NAME[sel.type]}</span>
                <div className="ml-auto flex gap-0.5">
                  <Button size="icon-sm" variant="ghost" title="Bring to front" aria-label="Bring to front" onClick={() => layer(sel.id, 'up')}><ArrowUpToLine /></Button>
                  <Button size="icon-sm" variant="ghost" title="Send to back" aria-label="Send to back" onClick={() => layer(sel.id, 'down')}><ArrowDownToLine /></Button>
                  <Button size="icon-sm" variant="ghost" title="Duplicate" aria-label="Duplicate" onClick={() => duplicate(sel.id)}><Copy /></Button>
                  <Button size="icon-sm" variant="ghost" title="Delete" aria-label="Delete" className="text-destructive" onClick={() => remove(sel.id)}><Trash2 /></Button>
                </div>
              </div>

              {sel.type === 'text' && (
                <Section title="Text">
                  <Textarea aria-label="Text" rows={5} className="font-mono text-xs" value={sel.text} onChange={(e) => update(sel.id, { text: e.target.value })} />
                  <NativeSelect className="h-8 text-xs" aria-label="Insert a field" value="" onChange={(e) => e.target.value && update(sel.id, { text: `${sel.text}{{${e.target.value}}}` })}>
                    <option value="">Insert a field…</option>
                    {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </NativeSelect>
                  <p className="text-2xs text-muted-foreground">A line whose fields are all empty is left out when printed.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-2xs text-muted-foreground">
                      Font
                      <NativeSelect className="h-8 text-xs" value={sel.fontFamily} onChange={(e) => update(sel.id, { fontFamily: e.target.value as 'sans' })}>
                        <option value="sans">Sans</option>
                        <option value="serif">Serif</option>
                        <option value="script">Script</option>
                        <option value="mono">Mono</option>
                      </NativeSelect>
                    </label>
                    <Num label="Size (pt)" value={sel.fontSize} step={0.5} min={4} max={120} onChange={(v) => update(sel.id, { fontSize: v })} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]] as const).map(([a, I]) => (
                      <Button key={a} size="icon-sm" variant={sel.align === a ? 'default' : 'outline'} aria-label={`Align ${a}`} onClick={() => update(sel.id, { align: a })}><I /></Button>
                    ))}
                    <Button size="icon-sm" variant={sel.fontWeight === 700 ? 'default' : 'outline'} aria-label="Bold" onClick={() => update(sel.id, { fontWeight: sel.fontWeight === 700 ? 400 : 700 })}><Bold /></Button>
                    <Button size="icon-sm" variant={sel.italic ? 'default' : 'outline'} aria-label="Italic" onClick={() => update(sel.id, { italic: !sel.italic })}><Italic /></Button>
                    <Button size="sm" variant={sel.uppercase ? 'default' : 'outline'} className="h-7 px-2 text-2xs" onClick={() => update(sel.id, { uppercase: !sel.uppercase })}>AA</Button>
                  </div>
                  <ColorField label="Colour" value={sel.color} onChange={(v) => update(sel.id, { color: v })} />
                  <div className="grid grid-cols-2 gap-2">
                    <Num label="Line height" value={sel.lineHeight ?? 1.4} step={0.05} min={0.8} max={3} onChange={(v) => update(sel.id, { lineHeight: v })} />
                    <Num label="Letter spacing" value={sel.letterSpacing ?? 0} step={0.25} min={-2} max={20} onChange={(v) => update(sel.id, { letterSpacing: v })} />
                  </div>
                </Section>
              )}
              {sel.type === 'image' && (
                <Section title="Image">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => replaceInput.current?.click()}><Upload /> Replace</Button>
                    {sel.src !== 'logo' && <Button size="sm" variant="ghost" onClick={() => update(sel.id, { src: 'logo' })}>Use the clinic logo</Button>}
                  </div>
                  <input ref={replaceInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => upload(e.target.files?.[0], (src) => update(sel.id, { src }))} />
                  {sel.src === 'logo' && <p className="text-2xs text-muted-foreground">Shows the logo from Settings → Branding.</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-2xs text-muted-foreground">
                      Fit
                      <NativeSelect className="h-8 text-xs" value={sel.fit} onChange={(e) => update(sel.id, { fit: e.target.value as 'contain' })}>
                        <option value="contain">Fit inside</option>
                        <option value="cover">Fill</option>
                      </NativeSelect>
                    </label>
                    <Num label="Opacity" value={sel.opacity ?? 1} step={0.05} min={0.05} max={1} onChange={(v) => update(sel.id, { opacity: v })} />
                  </div>
                </Section>
              )}
              {(sel.type === 'qr' || sel.type === 'barcode') && (
                <Section title={sel.type === 'qr' ? 'QR code' : 'Barcode'}>
                  <p className="text-2xs text-muted-foreground">{sel.type === 'qr' ? 'Opens the verification page for the certificate when scanned with a phone.' : 'The verification code, for barcode scanners (type or scan it at /verify).'}</p>
                  <ColorField label="Colour" value={sel.color} onChange={(v) => update(sel.id, { color: v })} />
                  {sel.type === 'barcode' && (
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={!!sel.showText} onChange={(e) => update(sel.id, { showText: e.target.checked })} /> Show the code under the bars
                    </label>
                  )}
                </Section>
              )}
              {sel.type === 'line' && (
                <Section title="Line">
                  <ColorField label="Colour" value={sel.color} onChange={(v) => update(sel.id, { color: v })} />
                  <div className="grid grid-cols-2 gap-2">
                    <Num label="Thickness (mm)" value={sel.thickness} step={0.1} min={0.1} max={10} onChange={(v) => update(sel.id, { thickness: v })} />
                    <label className="grid gap-1 text-2xs text-muted-foreground">
                      Style
                      <NativeSelect className="h-8 text-xs" value={sel.style} onChange={(e) => update(sel.id, { style: e.target.value as 'solid' })}>
                        <option value="solid">Solid</option>
                        <option value="dashed">Dashed</option>
                        <option value="dotted">Dotted</option>
                      </NativeSelect>
                    </label>
                  </div>
                  <p className="text-2xs text-muted-foreground">Make it taller than wide for a vertical line.</p>
                </Section>
              )}
              {sel.type === 'box' && (
                <Section title="Box / frame">
                  <ColorField label="Border" value={sel.borderColor} onChange={(v) => update(sel.id, { borderColor: v })} />
                  <div className="grid grid-cols-2 gap-2">
                    <Num label="Border (mm)" value={sel.borderWidth} step={0.1} min={0} max={10} onChange={(v) => update(sel.id, { borderWidth: v })} />
                    <label className="grid gap-1 text-2xs text-muted-foreground">
                      Style
                      <NativeSelect className="h-8 text-xs" value={sel.borderStyle} onChange={(e) => update(sel.id, { borderStyle: e.target.value as 'solid' })}>
                        <option value="solid">Solid</option>
                        <option value="double">Double</option>
                        <option value="dashed">Dashed</option>
                        <option value="dotted">Dotted</option>
                      </NativeSelect>
                    </label>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    {sel.fill === 'transparent' ? <p className="text-2xs text-muted-foreground">No fill</p> : <ColorField label="Fill" value={sel.fill} onChange={(v) => update(sel.id, { fill: v })} />}
                    <Button size="sm" variant="outline" onClick={() => update(sel.id, { fill: sel.fill === 'transparent' ? '#f8fafc' : 'transparent' })}>{sel.fill === 'transparent' ? 'Add fill' : 'No fill'}</Button>
                  </div>
                  <Num label="Corner radius (mm)" value={sel.radius} step={0.5} min={0} max={50} onChange={(v) => update(sel.id, { radius: v })} />
                </Section>
              )}
              {sel.type === 'table' && (
                <Section title="Vaccinations table">
                  <p className="text-2xs text-muted-foreground">Lists the vaccinations chosen when the certificate is issued.</p>
                  <Num label="Text size (pt)" value={sel.fontSize} step={0.5} min={5} max={16} onChange={(v) => update(sel.id, { fontSize: v })} />
                  <ColorField label="Header" value={sel.headerColor} onChange={(v) => update(sel.id, { headerColor: v })} />
                  <ColorField label="Text" value={sel.color} onChange={(v) => update(sel.id, { color: v })} />
                </Section>
              )}
              {sel.type === 'watermark' && (
                <Section title="Watermark">
                  <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Watermark type">
                    <Button size="sm" variant={sel.mode === 'text' ? 'default' : 'outline'} role="radio" aria-checked={sel.mode === 'text'} onClick={() => update(sel.id, { mode: 'text' })}><Type /> Text</Button>
                    <Button size="sm" variant={sel.mode === 'image' ? 'default' : 'outline'} role="radio" aria-checked={sel.mode === 'image'} onClick={() => update(sel.id, { mode: 'image' })}><ImageIcon /> Image</Button>
                  </div>
                  <label className="grid gap-1 text-2xs text-muted-foreground">
                    Opacity — {Math.round(sel.opacity * 100)}%
                    <input type="range" aria-label="Watermark opacity" min={2} max={100} step={1} value={Math.round(sel.opacity * 100)} onChange={(e) => update(sel.id, { opacity: Number(e.target.value) / 100 })} className="w-full accent-primary" />
                    <span className="flex justify-between"><span>Faint</span><span>Solid</span></span>
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {[5, 10, 15, 25, 50].map((p) => (
                      <Button key={p} size="sm" variant={Math.round(sel.opacity * 100) === p ? 'default' : 'outline'} className="h-7 px-2 text-2xs" onClick={() => update(sel.id, { opacity: p / 100 })}>{p}%</Button>
                    ))}
                  </div>
                  {sel.mode === 'text' ? (
                    <>
                      <Textarea aria-label="Watermark text" rows={2} className="font-mono text-xs" value={sel.text} maxLength={200} onChange={(e) => update(sel.id, { text: e.target.value })} />
                      <NativeSelect className="h-8 text-xs" aria-label="Insert a field" value="" onChange={(e) => e.target.value && update(sel.id, { text: `${sel.text}{{${e.target.value}}}` })}>
                        <option value="">Insert a field…</option>
                        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </NativeSelect>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="grid gap-1 text-2xs text-muted-foreground">
                          Font
                          <NativeSelect className="h-8 text-xs" value={sel.fontFamily} onChange={(e) => update(sel.id, { fontFamily: e.target.value as 'sans' })}>
                            <option value="sans">Sans</option>
                            <option value="serif">Serif</option>
                            <option value="script">Script</option>
                            <option value="mono">Mono</option>
                          </NativeSelect>
                        </label>
                        <Num label="Size (pt)" value={sel.fontSize} step={2} min={8} max={300} onChange={(v) => update(sel.id, { fontSize: v })} />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button size="icon-sm" variant={sel.fontWeight === 700 ? 'default' : 'outline'} aria-label="Bold" onClick={() => update(sel.id, { fontWeight: sel.fontWeight === 700 ? 400 : 700 })}><Bold /></Button>
                        <Button size="sm" variant={sel.uppercase ? 'default' : 'outline'} className="h-7 px-2 text-2xs" onClick={() => update(sel.id, { uppercase: !sel.uppercase })}>AA</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <ColorField label="Colour" value={sel.color} onChange={(v) => update(sel.id, { color: v })} />
                        <Num label="Letter spacing" value={sel.letterSpacing ?? 0} step={0.5} min={-2} max={40} onChange={(v) => update(sel.id, { letterSpacing: v })} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => replaceInput.current?.click()}><Upload /> Choose image</Button>
                        {sel.src !== 'logo' && <Button size="sm" variant="ghost" onClick={() => update(sel.id, { src: 'logo' })}>Use the clinic logo</Button>}
                      </div>
                      <input ref={replaceInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => upload(e.target.files?.[0], (src) => update(sel.id, { src }))} />
                      <p className="text-2xs text-muted-foreground">{sel.src === 'logo' ? 'Uses the logo from Settings → Branding.' : 'Your own image (a seal or crest works well).'}</p>
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => update(sel.id, { x: round(page.w / 2 - sel.w / 2, 0.1), y: round(page.h / 2 - sel.h / 2, 0.1) })}>Centre on the page</Button>
                    <Button size="sm" variant="ghost" onClick={() => update(sel.id, { rotate: sel.rotate === -30 ? 0 : -30 })}>{sel.rotate === -30 ? 'Straighten' : 'Tilt'}</Button>
                  </div>
                  <p className="text-2xs text-muted-foreground">Sits behind everything else on the page, and prints with it.</p>
                </Section>
              )}
              {sel.type === 'signature' && (
                <Section title="Signature">
                  <label className="grid gap-1 text-2xs text-muted-foreground">
                    Under the line
                    <Input className="h-8" value={sel.label} maxLength={80} onChange={(e) => update(sel.id, { label: e.target.value })} />
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={sel.showName} onChange={(e) => update(sel.id, { showName: e.target.checked })} /> Print the issuer’s name and registration
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <Num label="Text size (pt)" value={sel.fontSize} step={0.5} min={5} max={20} onChange={(v) => update(sel.id, { fontSize: v })} />
                    <ColorField label="Colour" value={sel.color} onChange={(v) => update(sel.id, { color: v })} />
                  </div>
                  <p className="text-2xs text-muted-foreground">To add a scanned signature or stamp, add an Image above the line.</p>
                </Section>
              )}

              <Section title="Position (mm)">
                <div className="grid grid-cols-2 gap-2">
                  <Num label="Left" value={sel.x} onChange={(v) => update(sel.id, { x: v })} />
                  <Num label="Top" value={sel.y} onChange={(v) => update(sel.id, { y: v })} />
                  <Num label="Width" value={sel.w} min={1} onChange={(v) => update(sel.id, { w: Math.max(1, v) })} />
                  <Num label="Height" value={sel.h} min={0.2} onChange={(v) => update(sel.id, { h: Math.max(0.2, v) })} />
                  <Num label="Rotate (°)" value={sel.rotate ?? 0} step={1} min={-180} max={180} onChange={(v) => update(sel.id, { rotate: v || undefined })} />
                  <div className="flex items-end">
                    <Button size="sm" variant="outline" className="w-full" onClick={() => update(sel.id, { x: round(page.w / 2 - sel.w / 2, 0.1) })}>Centre</Button>
                  </div>
                </div>
              </Section>
            </>
          ) : (
            <>
              <div className="border-b p-3">
                <p className="text-sm font-semibold">Page</p>
                <p className="text-2xs text-muted-foreground">Click an element to change it.</p>
              </div>
              <Section title="Paper">
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-2xs text-muted-foreground">
                    Size
                    <NativeSelect className="h-8 text-xs" value={layout.page.size} onChange={(e) => setPage({ size: e.target.value as 'A4' })}>
                      {Object.entries(PAGE_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </NativeSelect>
                  </label>
                  <label className="grid gap-1 text-2xs text-muted-foreground">
                    Orientation
                    <NativeSelect className="h-8 text-xs" value={layout.page.orientation} onChange={(e) => setPage({ orientation: e.target.value as 'portrait' })}>
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </NativeSelect>
                  </label>
                </div>
                <ColorField label="Background" value={layout.page.background} onChange={(v) => setPage({ background: v })} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => bgInput.current?.click()}><Upload /> Background image</Button>
                  {layout.page.backgroundImage && <Button size="sm" variant="ghost" onClick={() => setPage({ backgroundImage: null })}>Remove</Button>}
                </div>
                <input ref={bgInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0], (src) => setPage({ backgroundImage: src }))} />
              </Section>
              <Section title="Frame">
                <label className="grid gap-1 text-2xs text-muted-foreground">
                  Style
                  <NativeSelect className="h-8 text-xs" value={layout.page.border.style} onChange={(e) => setPage({ border: { ...layout.page.border, style: e.target.value as 'none' } })}>
                    {BORDER_STYLES.map((s) => <option key={s} value={s}>{s === 'none' ? 'No frame' : s[0].toUpperCase() + s.slice(1)}</option>)}
                  </NativeSelect>
                </label>
                {layout.page.border.style !== 'none' && (
                  <>
                    <ColorField label="Colour" value={layout.page.border.color} onChange={(v) => setPage({ border: { ...layout.page.border, color: v } })} />
                    <Num label="Distance from the edge (mm)" value={layout.page.border.inset} min={0} max={40} onChange={(v) => setPage({ border: { ...layout.page.border, inset: v } })} />
                  </>
                )}
              </Section>
              <Section title="On this page">
                <ul className="grid max-h-60 gap-0.5 overflow-y-auto">
                  {[...layout.elements].reverse().map((el) => {
                    const I = ICON[el.type];
                    return (
                      <li key={el.id}>
                        <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted" onClick={() => setSelected(el.id)}>
                          <I className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{el.type === 'text' ? el.text.split('\n')[0] || 'Text' : NAME[el.type]}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            </>
          )}
          <div className="border-t p-3">
            <Label className="text-2xs text-muted-foreground">Page {page.w} × {page.h} mm · {layout.elements.length} elements</Label>
          </div>
        </div>
      </div>
    </div>
  );
}
