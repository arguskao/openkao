WITH ordered_products AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id
      ORDER BY
        CASE WHEN sort_order <= 0 THEN 1 ELSE 0 END,
        sort_order ASC,
        name COLLATE NOCASE ASC,
        id ASC
    ) AS new_sort_order
  FROM products
)
UPDATE products
SET sort_order = (
  SELECT new_sort_order
  FROM ordered_products
  WHERE ordered_products.id = products.id
)
WHERE id IN (SELECT id FROM ordered_products);
