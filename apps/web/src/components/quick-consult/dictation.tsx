'use client';
import { Mic, MicOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* The browser's own speech recognition (Chrome, Edge, Safari). Nothing to install and no cost to the clinic. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Only one microphone is live at a time: starting another one stops the first. */
let active: Recognition | null = null;

/**
 * A microphone button for a text box: tap, speak, tap again (or pause) — the words are added to the box.
 * Hidden in browsers without speech recognition.
 */
export function DictateButton({ onText, label }: { onText: (text: string) => void; label: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setSupported(!!recognitionCtor());
    return () => rec.current?.stop();
  }, []);
  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    active?.stop();
    const r = new Ctor();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      text = text.trim();
      if (text) onTextRef.current(text.charAt(0).toUpperCase() + text.slice(1));
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast.error('Microphone blocked — allow it in the browser’s address bar to dictate');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast.error(`Dictation stopped (${e.error})`);
    };
    r.onend = () => {
      setListening(false);
      if (active === r) active = null;
    };
    rec.current = r;
    active = r;
    r.start();
    setListening(true);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? `Stop dictating ${label}` : `Dictate ${label}`}
      title={listening ? 'Listening… tap to stop' : 'Speak instead of typing (uses your browser’s speech recognition)'}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        listening ? 'animate-pulse border-destructive bg-destructive text-white' : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
      {listening ? 'Listening…' : 'Speak'}
    </button>
  );
}
