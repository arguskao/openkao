ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'staff';

UPDATE users
SET role = 'owner'
WHERE company_id IS NOT NULL
  AND id IN (
    SELECT MIN(id)
    FROM users
    WHERE company_id IS NOT NULL
    GROUP BY company_id
  );
