import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Database } from "sql.js";
import { applyMigrations, createSqlD1, migrationFiles } from "./helpers/sql-d1";

test("D1 migrations apply to an empty database", async () => {
  const d1 = await createSqlD1();

  applyMigrations(d1.rawDatabase);

  assert.equal(tableExists(d1.rawDatabase, "companies"), true);
  assert.equal(tableExists(d1.rawDatabase, "stores"), false);
  assert.equal(tableExists(d1.rawDatabase, "audit_logs"), true);
  assert.equal(tableExists(d1.rawDatabase, "request_rate_limits"), true);
  assert.equal(tableExists(d1.rawDatabase, "invoice_issuances"), true);
  assert.equal(columnExists(d1.rawDatabase, "invoices", "qrcode_left"), true);
  assert.equal(columnExists(d1.rawDatabase, "invoices", "qrcode_right"), true);
  assert.equal(columnExists(d1.rawDatabase, "invoices", "barcode_payload"), true);
  assert.equal(columnExists(d1.rawDatabase, "invoices", "voided_at"), true);
  assert.equal(columnExists(d1.rawDatabase, "invoices", "amego_void_response_json"), true);
  assert.equal(columnExists(d1.rawDatabase, "companies", "amego_printer_lang"), true);
  assert.equal(columnExists(d1.rawDatabase, "companies", "max_bound_devices"), true);
  assert.equal(columnExists(d1.rawDatabase, "users", "is_active"), true);
  assert.equal(columnExists(d1.rawDatabase, "print_jobs", "amego_print_sync_status"), true);
  assert.equal(columnExists(d1.rawDatabase, "print_jobs", "amego_print_attempt_count"), true);
  assert.equal(columnExists(d1.rawDatabase, "print_jobs", "amego_print_last_error"), true);
  assert.equal(columnExists(d1.rawDatabase, "print_jobs", "amego_print_next_retry_at"), true);
  assert.equal(columnExists(d1.rawDatabase, "print_jobs", "amego_print_synced_at"), true);
  assert.equal(foreignKeyIssueCount(d1.rawDatabase), 0);
  assert.equal(rowCount(d1.rawDatabase, "companies"), 0);
  assert.equal(rowCount(d1.rawDatabase, "print_jobs"), 0);
});

test("D1 old schema upgrade keeps row counts, foreign keys, and key queries valid", async () => {
  const d1 = await createSqlD1();
  const db = d1.rawDatabase;

  applyOnlyInitialMigration(db);
  insertOldSchemaFixture(db);

  assert.equal(rowCount(db, "companies"), 1);
  assert.equal(rowCount(db, "stores"), 1);
  assert.equal(rowCount(db, "products"), 1);

  applyMigrations(db, 1);

  assert.equal(tableExists(db, "stores"), false);
  assert.equal(rowCount(db, "companies"), 1);
  assert.equal(rowCount(db, "devices"), 1);
  assert.equal(rowCount(db, "categories"), 1);
  assert.equal(rowCount(db, "products"), 1);
  assert.equal(rowCount(db, "invoices"), 1);
  assert.equal(rowCount(db, "invoice_items"), 1);
  assert.equal(rowCount(db, "print_jobs"), 1);
  assert.equal(rowCount(db, "print_logs"), 1);
  assert.equal(foreignKeyIssueCount(db), 0);

  const migratedInvoice = firstRow<{ status: string }>(db, "SELECT status FROM invoices LIMIT 1");
  assert.equal(migratedInvoice.status, "issued");
  const migratedCompany = firstRow<{ amego_printer_lang: number; max_bound_devices: number }>(
    db,
    "SELECT amego_printer_lang, max_bound_devices FROM companies LIMIT 1"
  );
  assert.deepEqual(migratedCompany, { amego_printer_lang: 2, max_bound_devices: 1 });

  const product = firstRow<{ company_id: number; category_id: number; price_decimal_places: number }>(
    db,
    `SELECT p.company_id, p.category_id, c.price_decimal_places
     FROM products p
     JOIN companies c ON c.id = p.company_id
     JOIN categories cat ON cat.id = p.category_id`
  );
  assert.deepEqual(product, { company_id: 1, category_id: 1, price_decimal_places: 0 });

  const printJob = firstRow<{
    status: string;
    invoice_number: string;
    device_name: string;
    amego_print_sync_status: string;
  }>(
    db,
    `SELECT p.status, p.amego_print_sync_status, i.invoice_number, d.name AS device_name
     FROM print_jobs p
     JOIN invoices i ON i.id = p.invoice_id
     JOIN devices d ON d.id = p.device_id`
  );
  assert.deepEqual(printJob, {
    status: "pending",
    amego_print_sync_status: "not_required",
    invoice_number: "AB12345678",
    device_name: "Front iPhone"
  });
});

test("D1 integrity guards reject invalid business data", async () => {
  const d1 = await createSqlD1();
  const db = d1.rawDatabase;

  applyMigrations(db);
  db.run(`
    INSERT INTO companies (id, name, tax_id, unbind_code)
    VALUES (1, 'Guard Company', '12345678', '12345678');

    INSERT INTO categories (id, company_id, name, sort_order, status)
    VALUES (1, 1, '飲品', 0, '顯示');

    INSERT INTO invoices (
      id, company_id, invoice_number, random_number, issued_at,
      seller_identifier, total_amount
    )
    VALUES ('invoice-guard', 1, 'AB12345678', '1234', '2026-07-09T13:59:00Z', '12345678', 45);
  `);

  assert.throws(
    () => db.run(`
      INSERT INTO products (
        id, company_id, category_id, name, price, decimal_places,
        is_active, tax_type, sort_order
      )
      VALUES (1, 1, 1, '錯誤商品', -1, 0, 1, '含稅', 0)
    `),
    /products_integrity_check_failed/
  );

  assert.throws(
    () => db.run(`
      INSERT INTO invoice_items (id, invoice_id, name, quantity, unit_price, amount)
      VALUES ('item-guard', 'invoice-guard', '奶茶', 2, 45, 45)
    `),
    /invoice_items_integrity_check_failed/
  );

  assert.throws(
    () => db.run(`
      INSERT INTO users (id, company_id, email, password_hash, name, phone, role)
      VALUES (1, 1, 'owner@example.test', 'hash', 'Owner', NULL, 'manager')
    `),
    /users_integrity_check_failed/
  );

  assert.throws(
    () => db.run(`
      INSERT INTO print_jobs (id, company_id, invoice_id, status, payload_json, attempt_count)
      VALUES (
        'job-guard', 1, 'invoice-guard', 'unknown',
        '{"invoiceNumber":"AB12345678"}', 0
      )
    `),
    /print_jobs_integrity_check_failed/
  );

  assert.throws(
    () => db.run(`
      INSERT INTO invoice_issuances (
        id, company_id, order_id, idempotency_key, request_hash, status, request_json
      )
      VALUES ('issuance-guard', 1, 'ORDER-1', 'KEY-1', 'short', 'issuing', '{}')
    `),
    /invoice_issuances_integrity_check_failed/
  );

  assert.throws(
    () => db.run(`UPDATE companies SET amego_printer_lang = 4 WHERE id = 1`),
    /companies_amego_printer_integrity_check_failed/
  );

  assert.throws(
    () => db.run(`UPDATE companies SET max_bound_devices = 0 WHERE id = 1`),
    /companies_device_limit_check_failed/
  );

  assert.throws(
    () => db.run(`
      INSERT INTO users (id, company_id, email, password_hash, name, phone, role, is_active)
      VALUES (2, 1, 'staff@example.test', 'hash', 'Staff', NULL, 'staff', 2)
    `),
    /users_active_check_failed/
  );

  assert.throws(
    () => db.run(`
      INSERT INTO invoices (
        id, company_id, invoice_number, random_number, issued_at,
        seller_identifier, total_amount, amego_order_id
      )
      VALUES (
        'invoice-missing-payload', 1, 'CD12345678', '5678',
        '2026-07-12T10:00:00Z', '12345678', 45, 'ORDER-MISSING'
      )
    `),
    /invoices_amego_integrity_check_failed/
  );

  assert.throws(
    () => db.run(`
      INSERT INTO print_jobs (id, company_id, invoice_id, status, payload_json)
      VALUES (
        'job-wrong-invoice', 1, 'invoice-guard', 'pending',
        '{"invoiceNumber":"ZZ99999999"}'
      )
    `),
    /print_jobs_invoice_payload_mismatch/
  );

  assert.throws(
    () => db.run(`
      INSERT INTO print_jobs (id, company_id, invoice_id, status, payload_json)
      VALUES ('job-invalid-json', 1, 'invoice-guard', 'pending', 'not-json')
    `),
    /print_jobs_payload_json_invalid/
  );

  assert.throws(
    () => db.run(`
      INSERT INTO print_jobs (
        id, company_id, invoice_id, status, payload_json,
        amego_print_sync_status, amego_print_attempt_count
      )
      VALUES (
        'job-invalid-amego-sync', 1, 'invoice-guard', 'pending',
        '{"invoiceNumber":"AB12345678"}', 'unknown', 0
      )
    `),
    /print_jobs_amego_sync_integrity_check_failed/
  );
});

test("D1 Amego print sync migration backfills only the earliest printed original", async () => {
  const d1 = await createSqlD1();
  const db = d1.rawDatabase;
  const migrations = migrationFiles();
  for (const migration of migrations.slice(0, -1)) {
    db.exec(fs.readFileSync(migration, "utf8"));
  }
  db.run(`
    INSERT INTO companies (id, name, tax_id, amego_app_key)
    VALUES (1, 'Backfill Company', '12345678', 'test-app-key');

    INSERT INTO invoices (
      id, company_id, invoice_number, random_number, issued_at,
      seller_identifier, total_amount, amego_order_id, status,
      barcode_payload, qrcode_left, qrcode_right
    )
    VALUES (
      'invoice-backfill', 1, 'AB12345678', '1234', '2026-07-09T13:59:00Z',
      '12345678', 45, 'ORDER-BACKFILL', 'issued',
      'BARCODE', 'LEFT', 'RIGHT'
    );

    INSERT INTO invoice_items (id, invoice_id, name, quantity, unit_price, amount)
    VALUES ('item-backfill', 'invoice-backfill', '奶茶', 1, 45, 45);

    INSERT INTO print_jobs (
      id, company_id, invoice_id, status, payload_json, printed_at, created_at
    )
    VALUES
      (
        'job-original-first', 1, 'invoice-backfill', 'printed',
        '{"invoiceNumber":"AB12345678","barcodePayload":"BARCODE","leftQRCodePayload":"LEFT","rightQRCodePayload":"RIGHT"}',
        '2026-07-09 10:00:00', '2026-07-09 10:00:00'
      ),
      (
        'job-original-second', 1, 'invoice-backfill', 'printed',
        '{"invoiceNumber":"AB12345678","barcodePayload":"BARCODE","leftQRCodePayload":"LEFT","rightQRCodePayload":"RIGHT"}',
        '2026-07-09 10:01:00', '2026-07-09 10:01:00'
      ),
      (
        'job-reprint', 1, 'invoice-backfill', 'printed',
        '{"invoiceNumber":"AB12345678","isReprint":true,"barcodePayload":"BARCODE","leftQRCodePayload":"LEFT","rightQRCodePayload":"RIGHT"}',
        '2026-07-09 10:02:00', '2026-07-09 10:02:00'
      );
  `);

  db.exec(fs.readFileSync(migrations.at(-1)!, "utf8"));

  const rows = allRows<{ id: string; amego_print_sync_status: string }>(
    db,
    "SELECT id, amego_print_sync_status FROM print_jobs ORDER BY created_at ASC"
  );
  assert.deepEqual(rows, [
    { id: "job-original-first", amego_print_sync_status: "pending" },
    { id: "job-original-second", amego_print_sync_status: "not_required" },
    { id: "job-reprint", amego_print_sync_status: "not_required" }
  ]);
});

function applyOnlyInitialMigration(db: Database): void {
  db.exec(fs.readFileSync(path.resolve(process.cwd(), "migrations/0001_initial.sql"), "utf8"));
}

function insertOldSchemaFixture(db: Database): void {
  db.run(`
    INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
    VALUES ('user-old', 'owner@example.test', 'hash', 'Owner', '2026-07-09 10:00:00', '2026-07-09 10:00:00');

    INSERT INTO companies (id, name, tax_id, amego_invoice_no, amego_app_key_secret_name, created_at, updated_at)
    VALUES ('company-old', 'Old Company', '12345678', 'AB', 'AMEGO_APP_KEY_PENDING', '2026-07-09 10:00:00', '2026-07-09 10:00:00');

    INSERT INTO stores (id, company_id, name, address, created_at, updated_at)
    VALUES ('store-old', 'company-old', 'Main Store', 'Taipei', '2026-07-09 10:01:00', '2026-07-09 10:01:00');

    INSERT INTO devices (id, company_id, store_id, name, token, platform, last_seen_at, created_at, updated_at)
    VALUES ('device-old', 'company-old', 'store-old', 'Front iPhone', 'legacy-token', 'ios', NULL, '2026-07-09 10:02:00', '2026-07-09 10:02:00');

    INSERT INTO categories (id, company_id, name, sort_order, created_at, updated_at)
    VALUES ('category-old', 'company-old', '飲品', 0, '2026-07-09 10:03:00', '2026-07-09 10:03:00');

    INSERT INTO products (id, company_id, category_id, name, price, is_active, created_at, updated_at)
    VALUES ('product-old', 'company-old', 'category-old', '奶茶', 45, 1, '2026-07-09 10:04:00', '2026-07-09 10:04:00');

    INSERT INTO invoices (
      id, company_id, store_id, invoice_number, random_number, issued_at,
      seller_name, seller_identifier, buyer_identifier, total_amount,
      amego_response_json, created_at, updated_at
    )
    VALUES (
      'invoice-old', 'company-old', 'store-old', 'AB12345678', '1234', '2026-07-09T13:59:00Z',
      'Old Company', '12345678', NULL, 45,
      NULL, '2026-07-09 10:05:00', '2026-07-09 10:05:00'
    );

    INSERT INTO invoice_items (id, invoice_id, name, quantity, unit_price, amount)
    VALUES ('item-old', 'invoice-old', '奶茶', 1, 45, 45);

    INSERT INTO print_jobs (
      id, company_id, store_id, device_id, invoice_id, status, payload_json,
      last_error, printed_at, created_at, updated_at
    )
    VALUES (
      'job-old', 'company-old', 'store-old', 'device-old', 'invoice-old', 'pending',
      '{"remoteId":"job-old","invoiceNumber":"AB12345678","randomNumber":"1234","issuedAt":"2026-07-09T13:59:00Z","sellerIdentifier":"12345678","totalAmount":45,"items":[{"id":"item-old","name":"奶茶","quantity":1,"unitPrice":45}]}',
      NULL, NULL, '2026-07-09 10:06:00', '2026-07-09 10:06:00'
    );

    INSERT INTO print_logs (id, print_job_id, device_id, status, message, created_at)
    VALUES ('log-old', 'job-old', 'device-old', 'pending', NULL, '2026-07-09 10:07:00');
  `);
}

function tableExists(db: Database, tableName: string): boolean {
  return scalar<number>(
    db,
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  ) === 1;
}

function columnExists(db: Database, tableName: string, columnName: string): boolean {
  const statement = db.prepare(`PRAGMA table_info(${tableName})`);
  try {
    while (statement.step()) {
      const row = statement.getAsObject() as { name?: string };
      if (row.name === columnName) {
        return true;
      }
    }
    return false;
  } finally {
    statement.free();
  }
}

function rowCount(db: Database, tableName: string): number {
  return scalar<number>(db, `SELECT COUNT(*) FROM ${tableName}`);
}

function foreignKeyIssueCount(db: Database): number {
  const result = db.exec("PRAGMA foreign_key_check");
  return result[0]?.values.length ?? 0;
}

function firstRow<T>(db: Database, sql: string): T {
  const result = db.exec(sql);
  const columns = result[0]?.columns ?? [];
  const values = result[0]?.values[0] ?? [];
  return Object.fromEntries(columns.map((column, index) => [column, values[index]])) as T;
}

function allRows<T>(db: Database, sql: string): T[] {
  const result = db.exec(sql);
  const columns = result[0]?.columns ?? [];
  return (result[0]?.values ?? []).map((values) => (
    Object.fromEntries(columns.map((column, index) => [column, values[index]])) as T
  ));
}

function scalar<T>(db: Database, sql: string, params: unknown[] = []): T {
  const statement = db.prepare(sql);
  try {
    statement.bind(params as never[]);
    assert.equal(statement.step(), true);
    return statement.get()[0] as T;
  } finally {
    statement.free();
  }
}
