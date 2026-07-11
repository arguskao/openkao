import { requireCatalogWriteAccess, requireOwnerAccess } from "./auth";
import type { CatalogCategoryRow, CatalogProductRow, UserSession } from "./domain-types";
import { HttpError, json } from "./http";
import {
  integerPower10,
  normalizeDecimalPlaces,
  normalizeOptionalString,
  normalizeSortOrder,
  normalizeStatus,
  normalizeTaxType,
  parseAdminProductBody,
  parseCatalogCategoryBody,
  parseCatalogProductBody,
  parsePositiveId
} from "./request-parsers";
import type { Env, RequestContext } from "./types";
import { readJson } from "./validation";

type SystemAuditWriter = (
  env: Env,
  input: {
    companyId: number;
    actorUserId?: number | null;
    actorDeviceId?: string | null;
    targetType: string;
    targetId: string;
    action: string;
    details?: Record<string, unknown> | null;
  }
) => Promise<void>;

export async function listCatalogCategories(env: Env, session: UserSession): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT
       c.id,
       c.name,
       c.sort_order,
       c.status,
       COUNT(p.id) AS product_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id AND p.company_id = c.company_id
     WHERE c.company_id = ?
     GROUP BY c.id, c.name, c.sort_order, c.status
     ORDER BY c.sort_order ASC, c.name ASC`
  )
    .bind(session.company_id)
    .all<CatalogCategoryRow>();

  return json({
    categories: result.results.map(mapCatalogCategoryRow)
  });
}

export async function createCatalogCategory(request: Request, env: Env, session: UserSession): Promise<Response> {
  requireCatalogWriteAccess(session);
  const input = parseCatalogCategoryBody(await readJson<Record<string, unknown>>(request));
  const status = normalizeStatus(input.status);
  const sortOrder = normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `INSERT INTO categories (id, company_id, name, sort_order, status)
     VALUES (NULL, ?, ?, ?, ?)`
  )
    .bind(session.company_id, input.name.trim(), sortOrder, status)
    .run();
  const id = Number(result.meta.last_row_id);

  return json({
    category: {
      id,
      name: input.name.trim(),
      sortOrder,
      status,
      productCount: 0
    }
  }, 201);
}

export async function updateCatalogCategory(
  request: Request,
  env: Env,
  session: UserSession,
  categoryIdValue: string
): Promise<Response> {
  requireCatalogWriteAccess(session);
  const categoryId = parsePositiveId(categoryIdValue, "categoryId");
  const input = parseCatalogCategoryBody(await readJson<Record<string, unknown>>(request));
  const status = normalizeStatus(input.status);
  const sortOrder = normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `UPDATE categories
     SET name = ?, sort_order = ?, status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`
  )
    .bind(input.name.trim(), sortOrder, status, categoryId, session.company_id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "category_not_found");
  }

  return json({
    category: {
      id: categoryId,
      name: input.name.trim(),
      sortOrder,
      status,
      productCount: 0
    }
  });
}

export async function deleteCatalogCategory(env: Env, session: UserSession, categoryIdValue: string): Promise<Response> {
  requireCatalogWriteAccess(session);
  const categoryId = parsePositiveId(categoryIdValue, "categoryId");
  const result = await env.DB.prepare(
    `DELETE FROM categories
     WHERE id = ? AND company_id = ?`
  )
    .bind(categoryId, session.company_id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "category_not_found");
  }

  return json({ ok: true });
}

export async function listCatalogProducts(env: Env, session: UserSession): Promise<Response> {
  const priceDecimalPlaces = await fetchCompanyPriceDecimalPlaces(env, session.company_id);
  const result = await env.DB.prepare(
    `SELECT
       p.id,
       p.category_id,
       c.name AS category_name,
       p.name,
       p.price,
       p.decimal_places,
       p.image_path,
       p.is_active,
       p.tax_type,
       p.sort_order
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.company_id = ?
     ORDER BY p.sort_order ASC, p.name ASC`
  )
    .bind(session.company_id)
    .all<CatalogProductRow>();

  return json({
    priceDecimalPlaces,
    products: result.results.map(mapCatalogProductRow)
  });
}

export async function createCatalogProduct(request: Request, env: Env, session: UserSession): Promise<Response> {
  requireCatalogWriteAccess(session);
  const input = parseCatalogProductBody(await readJson<Record<string, unknown>>(request));
  const normalizedCategoryId = await validateCategoryId(env, session.company_id, input.categoryId ?? null);
  const status = normalizeStatus(input.status);
  const taxType = normalizeTaxType(input.taxType);
  const decimalPlaces = await fetchCompanyPriceDecimalPlaces(env, session.company_id);
  const sortOrder = input.sortOrder == null
    ? await nextProductSortOrder(env, session.company_id)
    : normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `INSERT INTO products (id, company_id, category_id, name, price, decimal_places, image_path, is_active, tax_type, sort_order)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      session.company_id,
      normalizedCategoryId,
      input.name.trim(),
      input.price,
      decimalPlaces,
      normalizeOptionalString(input.imagePath),
      status === "顯示" ? 1 : 0,
      taxType,
      sortOrder
    )
    .run();
  const id = Number(result.meta.last_row_id);

  return json({
    product: await fetchCatalogProductById(env, session.company_id, id)
  }, 201);
}

export async function updateCatalogProduct(
  request: Request,
  env: Env,
  session: UserSession,
  productIdValue: string
): Promise<Response> {
  requireCatalogWriteAccess(session);
  const productId = parsePositiveId(productIdValue, "productId");
  const input = parseCatalogProductBody(await readJson<Record<string, unknown>>(request));
  const normalizedCategoryId = await validateCategoryId(env, session.company_id, input.categoryId ?? null);
  const status = normalizeStatus(input.status);
  const taxType = normalizeTaxType(input.taxType);
  const decimalPlaces = await fetchCompanyPriceDecimalPlaces(env, session.company_id);
  const sortOrder = normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `UPDATE products
     SET category_id = ?, name = ?, price = ?, decimal_places = ?, image_path = ?, is_active = ?, tax_type = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`
  )
    .bind(
      normalizedCategoryId,
      input.name.trim(),
      input.price,
      decimalPlaces,
      normalizeOptionalString(input.imagePath),
      status === "顯示" ? 1 : 0,
      taxType,
      sortOrder,
      productId,
      session.company_id
    )
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "product_not_found");
  }

  return json({
    product: await fetchCatalogProductById(env, session.company_id, productId)
  });
}

export async function updateCatalogSettings(request: Request, env: Env, session: UserSession): Promise<Response> {
  requireOwnerAccess(session);
  const input = await readJson<{ priceDecimalPlaces?: number }>(request);
  const nextValue = normalizeDecimalPlaces(input.priceDecimalPlaces);
  const currentValue = await fetchCompanyPriceDecimalPlaces(env, session.company_id);

  if (nextValue !== currentValue) {
    const updateCompanyStatement = env.DB.prepare(
      `UPDATE companies
       SET price_decimal_places = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(nextValue, session.company_id);

    if (nextValue > currentValue) {
      const multiplier = integerPower10(nextValue - currentValue);
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE products
           SET price = price * ?, decimal_places = ?, updated_at = CURRENT_TIMESTAMP
           WHERE company_id = ?`
        ).bind(multiplier, nextValue, session.company_id),
        updateCompanyStatement
      ]);
    } else {
      const divisor = integerPower10(currentValue - nextValue);
      const precisionLoss = await env.DB.prepare(
        `SELECT COUNT(*) AS value
         FROM products
         WHERE company_id = ?
           AND (price % ?) != 0`
      )
        .bind(session.company_id, divisor)
        .first<{ value: number | null }>();

      if (Number(precisionLoss?.value ?? 0) > 0) {
        throw new HttpError(400, "price_decimal_places_precision_loss");
      }

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE products
           SET price = price / ?, decimal_places = ?, updated_at = CURRENT_TIMESTAMP
           WHERE company_id = ?`
        ).bind(divisor, nextValue, session.company_id),
        updateCompanyStatement
      ]);
    }
  }

  return json({ priceDecimalPlaces: nextValue });
}

export async function deleteCatalogProduct(env: Env, session: UserSession, productIdValue: string): Promise<Response> {
  requireCatalogWriteAccess(session);
  const productId = parsePositiveId(productIdValue, "productId");
  const result = await env.DB.prepare(
    `DELETE FROM products
     WHERE id = ? AND company_id = ?`
  )
    .bind(productId, session.company_id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "product_not_found");
  }

  return json({ ok: true });
}

export async function listProducts(env: Env, url: URL): Promise<Response> {
  const companyId = parsePositiveId(url.searchParams.get("companyId"), "companyId");

  const result = await env.DB.prepare(
    `SELECT id, category_id, name, price, image_path, is_active, tax_type, sort_order, created_at, decimal_places
     FROM products
     WHERE company_id = ?
     ORDER BY sort_order ASC, name ASC`
  )
    .bind(companyId)
    .all<CatalogProductRow>();

  return json({ products: result.results.map(mapCatalogProductRow) });
}

export async function createProduct(
  request: Request,
  env: Env,
  context: RequestContext,
  writeSystemAuditLog: SystemAuditWriter
): Promise<Response> {
  const input = parseAdminProductBody(await readJson<Record<string, unknown>>(request));

  const companyId = parsePositiveId(input.companyId, "companyId");
  context.companyId = companyId;
  const normalizedCategoryId = await validateCategoryId(env, companyId, input.categoryId ?? null);
  const status = normalizeStatus(input.status);
  const taxType = normalizeTaxType(input.taxType);
  const decimalPlaces = await fetchCompanyPriceDecimalPlaces(env, companyId);
  const sortOrder = input.sortOrder == null
    ? await nextProductSortOrder(env, companyId)
    : normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `INSERT INTO products (id, company_id, category_id, name, price, decimal_places, image_path, is_active, tax_type, sort_order)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      companyId,
      normalizedCategoryId,
      input.name.trim(),
      input.price,
      decimalPlaces,
      normalizeOptionalString(input.imagePath),
      status === "顯示" ? 1 : 0,
      taxType,
      sortOrder
    )
    .run();

  const productId = Number(result.meta.last_row_id);
  await writeSystemAuditLog(env, {
    companyId,
    targetType: "product",
    targetId: String(productId),
    action: "admin.product.create",
    details: {
      requestId: context.requestId,
      categoryId: normalizedCategoryId,
      price: input.price,
      status,
      taxType
    }
  });

  return json({ id: productId });
}

function mapCatalogCategoryRow(row: CatalogCategoryRow) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order ?? 0),
    status: normalizeStatus(row.status),
    productCount: Number(row.product_count ?? 0)
  };
}

function mapCatalogProductRow(row: CatalogProductRow) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    price: Number(row.price),
    decimalPlaces: Number(row.decimal_places ?? 0),
    imagePath: row.image_path,
    status: row.is_active === 0 ? "隱藏" : "顯示",
    taxType: normalizeTaxType(row.tax_type),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

async function fetchCatalogProductById(env: Env, companyId: number, productId: number) {
  const row = await env.DB.prepare(
    `SELECT
       p.id,
       p.category_id,
       c.name AS category_name,
       p.name,
       p.price,
       p.decimal_places,
       p.image_path,
       p.is_active,
       p.tax_type,
       p.sort_order
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ? AND p.company_id = ?`
  )
    .bind(productId, companyId)
    .first<CatalogProductRow>();

  if (!row) {
    throw new HttpError(404, "product_not_found");
  }

  return mapCatalogProductRow(row);
}

async function validateCategoryId(
  env: Env,
  companyId: number,
  categoryId: number | string | null
): Promise<number | null> {
  if (categoryId == null || categoryId === "") {
    return null;
  }

  const normalized = parsePositiveId(categoryId, "categoryId");

  const category = await env.DB.prepare(
    `SELECT id
     FROM categories
     WHERE id = ? AND company_id = ?`
  )
    .bind(normalized, companyId)
    .first<{ id: number }>();

  if (!category) {
    throw new HttpError(400, "invalid_category_id");
  }

  return normalized;
}

async function nextProductSortOrder(env: Env, companyId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) AS value
     FROM products
     WHERE company_id = ?`
  )
    .bind(companyId)
    .first<{ value: number | null }>();

  return Number(row?.value ?? 0) + 1;
}

async function fetchCompanyPriceDecimalPlaces(env: Env, companyId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT price_decimal_places
     FROM companies
     WHERE id = ?`
  )
    .bind(companyId)
    .first<{ price_decimal_places: number | null }>();

  return normalizeDecimalPlaces(row?.price_decimal_places ?? 0);
}
