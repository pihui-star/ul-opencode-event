/**
 * SQLite access helper.
 *
 * The plugin runs inside the OpenCode server (Bun), the CLI runs under Node.
 * Both provide a SQLite binding, so the database is opened with whichever is
 * available: `bun:sqlite` first, `node:sqlite` (Node >= 22.5) as fallback.
 *
 * Only read-only access is used - the database belongs to OpenCode.
 */

/** Minimal statement interface shared by bun:sqlite and node:sqlite. */
export interface SqlStatement {
  all(...params: unknown[]): Array<Record<string, unknown>>;
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

/** Minimal database interface shared by bun:sqlite and node:sqlite. */
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  close(): void;
}

/**
 * Open the OpenCode database in read-only mode.
 * Returns null when no SQLite implementation is available.
 */
export async function openReadonlyDatabase(dbPath: string): Promise<SqlDatabase | null> {
  // Bun (OpenCode server runtime)
  try {
    const bun = (await import('bun:sqlite')) as unknown as {
      Database: new (path: string, options?: { readonly?: boolean }) => SqlDatabase;
    };
    return new bun.Database(dbPath, { readonly: true });
  } catch {
    // not running under Bun - fall through
  }

  // Node >= 22.5 (CLI runtime, requires --experimental-sqlite on Node 22)
  try {
    const node = (await import('node:sqlite')) as unknown as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqlDatabase;
    };
    return new node.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}
