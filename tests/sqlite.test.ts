import { describe, test, expect, afterAll } from 'bun:test';

const fs = require('node:fs') as typeof import('node:fs');
const os = require('node:os') as typeof import('node:os');
const path = require('node:path');

import { openReadonlyDatabase } from '../src/sqlite';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-test-'));

afterAll(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

describe('openReadonlyDatabase', () => {
  test('returns null when the database file does not exist', async () => {
    const db = await openReadonlyDatabase(path.join(tempDir, 'missing.db'));
    expect(db).toBeNull();
  });
});
