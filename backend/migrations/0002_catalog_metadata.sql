PRAGMA foreign_keys = ON;

ALTER TABLE categories ADD COLUMN status TEXT NOT NULL DEFAULT '顯示';

ALTER TABLE products ADD COLUMN image_path TEXT;
ALTER TABLE products ADD COLUMN tax_type TEXT NOT NULL DEFAULT '含稅';
ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_categories_company_sort ON categories(company_id, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_products_company_category_sort ON products(company_id, category_id, sort_order, name);
