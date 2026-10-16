import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const PX_PER_MM = 96 / 25.4;

/**
 * Prints receipt markup in a hidden frame sized to the paper roll: the page is exactly the roll width and exactly
 * as long as the receipt (no blank paper fed after it), with no browser margins. Choose the receipt printer and
 * turn off "Headers and footers" in the print dialog once; browsers remember it. For printing without a dialog,
 * start Chrome with --kiosk-printing on the counter PC.
 */
export async function printReceipt(content: ReactElement, paperWidthMm: number): Promise<void> {
  const html = renderToStaticMarkup(content);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;right:0;bottom:0;width:${paperWidthMm}mm;height:10px;border:0;opacity:0;pointer-events:none;`;
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><style>
    html,body{margin:0;padding:0;background:#fff}
    [data-receipt]{break-after:page;page-break-after:always}
    [data-receipt]:last-child{break-after:auto;page-break-after:auto}
  </style></head><body>${html}</body></html>`);
  doc.close();

  // Wait for the logo (and any other images) so it is not missing from the print.
  await Promise.all(
    Array.from(doc.images).map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((resolve) => { img.onload = img.onerror = () => resolve(); setTimeout(resolve, 4000); }),
    ),
  );
  // Page height = the tallest receipt (each copy is its own page, so the printer cuts between copies).
  const receipts = Array.from(doc.querySelectorAll<HTMLElement>('[data-receipt]'));
  const heightMm = Math.ceil(Math.max(40, ...receipts.map((r) => r.getBoundingClientRect().height / PX_PER_MM)) + 2);
  const style = doc.createElement('style');
  style.textContent = `@page{size:${paperWidthMm}mm ${heightMm}mm;margin:0}`;
  doc.head.appendChild(style);

  // Lets tests (and diagnostics) see what was sent to the printer.
  window.dispatchEvent(new CustomEvent('vcms:receipt-print', { detail: { paperWidthMm, heightMm, copies: receipts.length, logoLoaded: Array.from(doc.images).some((i) => i.naturalWidth > 0), text: doc.body.innerText } }));
  const win = frame.contentWindow!;
  await new Promise<void>((resolve) => {
    const cleanup = () => { setTimeout(() => frame.remove(), 500); resolve(); };
    win.addEventListener('afterprint', cleanup, { once: true });
    win.focus();
    win.print();
    // Some browsers do not fire afterprint for frames; never leave the frame behind.
    setTimeout(cleanup, 60_000);
  });
}
