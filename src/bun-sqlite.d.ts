declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string, options?: { readonly?: boolean });
    prepare(sql: string): Statement;
    close(): void;
  }
  export class Statement {
    all(...params: unknown[]): Row[];
    get(...params: unknown[]): Row | null;
    run(...params: unknown[]): void;
  }
  export type Row = Record<string, unknown>;
}
