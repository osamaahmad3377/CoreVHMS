'use client';
import { useEffect, useState } from 'react';
import { Input, NativeSelect } from '../ui/input';

const OTHER = '__other__';

/**
 * A drop-down of common answers with an "Other" choice that shows a box to type the answer. The value is plain
 * text, so an answer typed earlier (not in the list) is shown under "Other" when the form is opened again.
 */
export function ChoiceOrOther({
  id,
  value,
  onChange,
  options,
  emptyLabel,
  specifyLabel,
  placeholder,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
  /** What the empty choice says, e.g. "Not recorded". */
  emptyLabel: string;
  /** The label of the box that appears for "Other", e.g. "Specify colour". */
  specifyLabel: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  const known = options.includes(value);
  const [other, setOther] = useState(!!value && !known);
  // A value that arrives from outside (editing a saved patient, or the species changing the list) decides the mode.
  useEffect(() => {
    if (value && !known) setOther(true);
    else if (known) setOther(false);
  }, [value, known]);
  const selected = other ? OTHER : known ? value : '';
  return (
    <div className="grid gap-2">
      <NativeSelect
        id={id}
        aria-invalid={invalid || undefined}
        value={selected}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER) {
            setOther(true);
            if (known) onChange('');
          } else {
            setOther(false);
            onChange(v);
          }
        }}
      >
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        <option value={OTHER}>Other (type it in)</option>
      </NativeSelect>
      {other && (
        <Input
          id={`${id}-other`}
          aria-label={specifyLabel}
          placeholder={placeholder ?? specifyLabel}
          value={known ? '' : value}
          maxLength={80}
          autoFocus={!value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
