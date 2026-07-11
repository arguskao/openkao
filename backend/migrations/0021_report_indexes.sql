CREATE INDEX IF NOT EXISTS idx_invoices_company_issued_at_id
ON invoices(company_id, issued_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id
ON invoice_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_print_jobs_company_invoice_created_id
ON print_jobs(company_id, invoice_id, created_at DESC, id DESC);
