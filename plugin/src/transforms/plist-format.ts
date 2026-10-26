/**
 * Rewrites plist XML to match Xcode / plutil xml1 layout: root <dict> at column 0,
 * one tab per nesting level, trailing newline.
 */
export function formatPlistLikeXcode(xml: string): string {
  const normalized = xml.replace(/\r\n/g, '\n').trimEnd();
  const lines = normalized.split('\n');
  const out: string[] = [];
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === '</dict>') {
      depth = Math.max(0, depth - 1);
    }
    if (trimmed === '<dict>') {
      if (depth === 0 && out.length > 0) {
        out.push('<dict>');
      } else {
        out.push(`${'\t'.repeat(depth)}<dict>`);
      }
      depth += 1;
      continue;
    }
    if (trimmed === '</dict>') {
      out.push(`${'\t'.repeat(depth)}</dict>`);
      continue;
    }
    if (trimmed === '<plist version="1.0">') {
      out.push('<plist version="1.0">');
      continue;
    }
    if (
      trimmed.startsWith('<?xml') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed === '</plist>'
    ) {
      out.push(trimmed);
      continue;
    }
    out.push(`${'\t'.repeat(depth)}${trimmed}`);
  }

  return `${out.join('\n')}\n`;
}
