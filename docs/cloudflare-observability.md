# Cloudflare Observability Alerts

Production observability is enabled in `backend/wrangler.toml`. Use Cloudflare Logs / Observability to create notification policies for these structured log events.

## Required Alerts

- 5xx responses
  - Filter: `event = "http.request" AND status >= 500`
  - Suggested threshold: at least 1 event in 5 minutes
  - Message fields: `requestId`, `route`, `status`, `latencyMs`, `companyId`, `deviceId`

- Duplicate print job replay
  - Filter: `event = "print_job.idempotent_replay"`
  - Suggested threshold: at least 3 events for the same `companyId` in 10 minutes
  - Message fields: `requestId`, `companyId`, `printJobId`, `invoiceId`

- Long pending print jobs
  - Filter: `event = "print_job.pending_stale"`
  - Suggested threshold: any event where `count > 0`
  - Message fields: `companyId`, `count`, `thresholdMinutes`

- Expired printing leases
  - Filter: `event = "print_job.printing_lease_expired"`
  - Suggested threshold: any event where `count > 0`
  - Message fields: `companyId`, `count`

## Sensitive Data Rule

Logs and audit details must not include bearer tokens, passwords, full invoice payloads, or full item lists. Keep identifiers, counts, status, and request IDs only.
