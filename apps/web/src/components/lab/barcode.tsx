/**
 * Code 128 (subset B) barcode as inline SVG — enough for sample labels (S00000006) without a dependency.
 * Each symbol is six alternating bar/space widths in modules; the stop symbol has seven.
 */
const PATTERNS = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232 2331112'
).split(' ');
const START_B = 104;
const STOP = 106;
const QUIET = 10; // modules of white space each side, required by scanners

/** Symbol values for `text` in Code 128 B, including the check symbol. Characters outside ASCII 32–126 are dropped. */
export function code128B(text: string): number[] {
  const data = [...text].map((c) => c.charCodeAt(0) - 32).filter((v) => v >= 0 && v <= 94);
  const check = (START_B + data.reduce((sum, v, i) => sum + v * (i + 1), 0)) % 103;
  return [START_B, ...data, check, STOP];
}

export function Code128({ value, height = 40, className, showText = true }: { value: string; height?: number; className?: string; showText?: boolean }) {
  const bars: { x: number; w: number }[] = [];
  let x = QUIET;
  for (const symbol of code128B(value)) {
    [...PATTERNS[symbol]].forEach((w, i) => {
      if (i % 2 === 0) bars.push({ x, w: Number(w) });
      x += Number(w);
    });
  }
  const width = x + QUIET;
  const textHeight = showText ? 12 : 0;
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height + textHeight}`} role="img" aria-label={`Barcode ${value}`} shapeRendering="crispEdges" preserveAspectRatio="xMidYMid meet">
      <rect width={width} height={height + textHeight} fill="#fff" />
      {bars.map((b) => <rect key={b.x} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
      {showText && (
        <text x={width / 2} y={height + 10} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={10} fill="#000">
          {value}
        </text>
      )}
    </svg>
  );
}
