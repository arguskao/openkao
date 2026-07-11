CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_company_invoice_number
ON invoices(company_id, invoice_number);
