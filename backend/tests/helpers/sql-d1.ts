import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs, { type Database, type SqlValue } from "sql.js";

const require = createRequire(import.meta.url);

type D1Meta = {
  changes: number;
  last_row_id: number;
  duration: number;
};

type SqlJsModule = Awaited<ReturnType<typeof initSqlJs>>;

let sqlModulePromise: Promise<SqlJsModule> | null = null;

export async function createSqlD1(): Promise<SqlJsD1Database> {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
    });
  }

  const SQL = await sqlModulePromise;
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");
  return new SqlJsD1Database(db);
}

export async function createMigratedSqlD1(): Promise<SqlJsD1Database> {
  const d1 = await createSqlD1();
  applyMigrations(d1.rawDatabase);
  return d1;
}

export function applyMigrations(db: Database, startIndex = 0): void {
  for (const migration of migrationFiles().slice(startIndex)) {
    db.exec(fs.readFileSync(migration, "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
}

export function migrationFiles(): string[] {
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  return fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => path.join(migrationsDir, file));
}

export class SqlJsD1Database {
  constructor(readonly rawDatabase: Database) {}

  prepare(query: string): SqlJsD1PreparedStatement {
    return new SqlJsD1PreparedStatement(this.rawDatabase, query);
  }

  async batch<T = unknown>(statements: SqlJsD1PreparedStatement[]): Promise<Array<D1Result<T>>> {
    this.rawDatabase.run("BEGIN");
    try {
      const results: Array<D1Result<T>> = [];
      for (const statement of statements) {
        results.push(await statement.run<T>());
      }
      this.rawDatabase.run("COMMIT");
      return results;
    } catch (error) {
      this.rawDatabase.run("ROLLBACK");
      throw error;
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.rawDatabase.exec(query);
    return { count: 1, duration: 0 };
  }
}

export class SqlJsD1PreparedStatement {
  constructor(
    private readonly db: Database,
    private readonly query: string,
    private readonly params: SqlValue[] = []
  ) {}

  bind(...values: unknown[]): SqlJsD1PreparedStatement {
    return new SqlJsD1PreparedStatement(this.db, this.query, values.map(normalizeBinding));
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const rows = this.selectRows<Record<string, SqlValue>>();
    const row = rows[0];
    if (!row) {
      return null;
    }
    return (columnName ? row[columnName] : row) as T;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return {
      results: this.selectRows<T>(),
      success: true,
      meta: this.meta()
    };
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const statement = this.db.prepare(this.query);
    try {
      statement.bind(this.params);
      while (statement.step()) {
        // Exhaust rows for statements that SQLite treats as returning rows.
      }
    } finally {
      statement.free();
    }

    return {
      results: [],
      success: true,
      meta: this.meta()
    };
  }

  private selectRows<T>(): T[] {
    const statement = this.db.prepare(this.query);
    const rows: T[] = [];
    try {
      statement.bind(this.params);
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  private meta(): D1Meta {
    const result = this.db.exec("SELECT changes() AS changes, last_insert_rowid() AS last_row_id");
    const values = result[0]?.values[0] ?? [0, 0];
    return {
      changes: Number(values[0] ?? 0),
      last_row_id: Number(values[1] ?? 0),
      duration: 0
    };
  }
}

function normalizeBinding(value: unknown): SqlValue {
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || value instanceof Uint8Array
  ) {
    return value;
  }
  return String(value);
}
