const DEFAULT_CONTEXT_USAGE_BUFFER_SIZE = 768;

const ANSI_STRIP_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][012AB]|\x1b.|\r/g;

export function stripAnsiForContextUsage(value: string): string {
  return value.replace(ANSI_STRIP_RE, '');
}

export function extractContextUsageFraction(buffer: string): number | null {
  const clean = stripAnsiForContextUsage(buffer);

  // "context: 82%", "82% context", "[context 82%]"
  const percentMatch = clean.match(
    /context[^%\n]{0,60}?(\d{1,3})%|(\d{1,3})%[^%\n]{0,40}?context/i,
  );
  if (percentMatch) {
    const percent = parseInt(percentMatch[1] ?? percentMatch[2], 10);
    if (percent >= 0 && percent <= 100) {
      return percent / 100;
    }
  }

  // "164,523 / 200,000 tokens"
  const tokenMatch = clean.match(/(\d[\d,]+)\s*\/\s*(\d[\d,]+)\s*(?:tokens?|tok)?\b/i);
  if (tokenMatch) {
    const used = parseInt(tokenMatch[1].replace(/,/g, ''), 10);
    const total = parseInt(tokenMatch[2].replace(/,/g, ''), 10);
    if (total >= 10_000 && used <= total) {
      return Math.min(used / total, 1.0);
    }
  }

  return null;
}

export function appendContextUsageBuffer(
  previous: string,
  chunk: string,
  maxLength = DEFAULT_CONTEXT_USAGE_BUFFER_SIZE,
): string {
  const next = previous + chunk;
  return next.length > maxLength ? next.slice(-maxLength) : next;
}
