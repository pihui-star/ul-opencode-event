import * as fs from 'node:fs';

const DEFAULT_TRUNCATE_MARKER = '[TRUNCATED] ... old records dropped\n';

/** Check if a file exceeds the given size limit. */
export function shouldRotate(filePath: string, maxSizeBytes: number): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.size > maxSizeBytes;
  } catch {
    return false;
  }
}

/** Truncate file by keeping only the second (newer) half, aligned to newline boundary. */
export function rotateFile(filePath: string, truncateMarker?: string): void {
  const marker = truncateMarker ?? DEFAULT_TRUNCATE_MARKER;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.length === 0) return;

    const mid = Math.floor(content.length / 2);
    const nl = content.indexOf('\n', mid);
    const cut = nl >= 0 ? nl + 1 : mid;

    fs.writeFileSync(filePath, marker + content.slice(cut), 'utf-8');
  } catch {
    // Rotation is best-effort – ignore failures silently
  }
}
