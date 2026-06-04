import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';

// Override any fs/node:fs mocks from earlier test files with real modules
const nodeRequire = createRequire(import.meta.url);
const realFs = nodeRequire('node:fs');
mock.module('fs', () => ({ ...realFs }));
mock.module('node:fs', () => ({ ...realFs }));

import * as fs from 'node:fs';
import { shouldRotate, rotateFile } from '../src/file-rotation.js';

const tmpDir = path.join(os.tmpdir(), 'file-rotation-test-' + process.pid);

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function tmpFile(name: string): string {
  return path.join(tmpDir, name);
}

describe('file-rotation', () => {
  test('shouldRotate returns false when file is under size limit', () => {
    const fp = tmpFile('small.txt');
    fs.writeFileSync(fp, 'short content', 'utf-8');
    expect(shouldRotate(fp, 1000)).toBe(false);
  });

  test('rotateFile truncates and keeps second half', () => {
    const fp = tmpFile('rotate.txt');
    // 200 lines of 10 chars each = ~2100 bytes (with newlines)
    const lines = Array.from({ length: 200 }, (_, i) => `line-${String(i).padStart(5, '0')}`);
    const content = lines.join('\n') + '\n';
    fs.writeFileSync(fp, content, 'utf-8');

    rotateFile(fp); // triggers rotation with default marker

    const result = fs.readFileSync(fp, 'utf-8');
    expect(result.startsWith('[TRUNCATED]')).toBe(true);
    // Should contain later lines (second half, ~line-00101 onward)
    expect(result).toContain('line-00150');
    // Should not contain early lines
    expect(result).not.toContain('line-00050');
    // Total size should be smaller than original
    expect(result.length).toBeLessThan(content.length);
  });

  test('rotateFile handles empty file without error', () => {
    const fp = tmpFile('empty.txt');
    fs.writeFileSync(fp, '', 'utf-8');
    expect(() => rotateFile(fp)).not.toThrow();
    expect(fs.readFileSync(fp, 'utf-8')).toBe('');
  });

  test('rotateFile writes custom truncate marker', () => {
    const fp = tmpFile('marker.txt');
    const lines = Array.from({ length: 100 }, (_, i) => `row-${i}`);
    const content = lines.join('\n') + '\n';
    fs.writeFileSync(fp, content, 'utf-8');

    rotateFile(fp, '--- truncated ---\n');

    const result = fs.readFileSync(fp, 'utf-8');
    expect(result.startsWith('--- truncated ---\n')).toBe(true);
  });
});
