ALTER TABLE companies ADD COLUMN price_decimal_places INTEGER NOT NULL DEFAULT 0;

UPDATE companies
SET price_decimal_places = COALESCE(
  (
    SELECT MAX(COALESCE(products.decimal_places, 0))
    FROM products
    WHERE products.company_id = companies.id
  ),
  0
);

UPDATE products
SET decimal_places = COALESCE(
  (
    SELECT companies.price_decimal_places
    FROM companies
    WHERE companies.id = products.company_id
  ),
  0
);
