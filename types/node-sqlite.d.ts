declare module "node:sqlite" {
  type SqliteValue = null | number | bigint | string | Uint8Array;

  type StatementRunResult = {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };

  export class StatementSync {
    all(...anonymousParameters: SqliteValue[]): Array<Record<string, unknown>>;
    get(...anonymousParameters: SqliteValue[]): Record<string, unknown> | undefined;
    run(...anonymousParameters: SqliteValue[]): StatementRunResult;
  }

  export class DatabaseSync {
    constructor(location: string);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
