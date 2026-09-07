# OpenvoKao Backend

Cloudflare Workers + D1 backend for the OpenvoKao iOS print terminal.

## What This Backend Does

- Provides a simple admin web page at `/`.
- Stores companies, users, devices, products, invoices, print jobs, print logs, and audit logs in D1.
- Supports account registration/login, first-device binding, user roles, and device-token APIs for pending print jobs.
- Receives printed / failed callbacks from iOS.
- Keeps Amego credentials on the backend side. The iOS app should not store Amego App Key.

## Local Setup

Install dependencies:

```sh
npm install
```

Create a local D1 database schema:

```sh
npm run d1:migrate:local
```

Run locally with a temporary plaintext admin token:

```sh
npx wrangler dev --var ADMIN_TOKEN:local-admin-token
```

Open:

```text
http://localhost:8787
```

Use `local-admin-token` in the admin page. For production, use `ADMIN_TOKEN_HASH` instead.

Run checks:

```sh
npm run types:wrangler:check
npm run typecheck
npm test
npm run test:migrations
npm run dry-run
```

## Cloudflare Setup

Create the D1 database:

```sh
npx wrangler d1 create openvokao-db
```

Copy the returned `database_id` into `wrangler.jsonc`.

Apply remote migrations:

```sh
npm run d1:migrate:remote
```

Set the admin token hash for production.

```sh
node -e "crypto.subtle.digest('SHA-256', new TextEncoder().encode('admin:' + process.argv[1])).then((digest) => console.log(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')))" "your-long-admin-token"
npx wrangler secret put ADMIN_TOKEN_HASH
```

For the production environment:

```sh
npx wrangler secret put ADMIN_TOKEN_HASH --env production
```

Production is configured in `wrangler.jsonc`. Because the product is not officially live yet, the current D1 database is also used for development/testing. Revisit separate staging and production databases before real customer data goes live.

`ADMIN_TOKEN` is still accepted for local development and migration windows, but production should use `ADMIN_TOKEN_HASH`.

Deploy after checks pass:

```sh
npm run deploy
```

## iOS API

iOS registers/logs in with an account, binds the first phone, and receives a device token. Device tokens are only shown when created or rotated.

All iOS API calls use:

```http
Authorization: Bearer <device-token>
```

Endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `DELETE /api/account` (requires the current password; owners delete the company workspace, staff delete their own account)
- `GET /api/devices/me`
- `GET /api/devices`
- `POST /api/devices`
- `PUT /api/devices/{id}`
- `DELETE /api/devices/{id}`
- `POST /api/devices/{id}/rotate-token`
- `GET /api/print-jobs/pending`
- `GET /api/print-jobs/{id}`
- `POST /api/print-jobs/{id}/printed`
- `POST /api/print-jobs/{id}/failed`
- `GET /api/catalog/categories`
- `POST /api/catalog/categories`
- `PUT /api/catalog/categories/{id}`
- `DELETE /api/catalog/categories/{id}`
- `GET /api/catalog/products`
- `POST /api/catalog/products`
- `PUT /api/catalog/products/{id}`
- `DELETE /api/catalog/products/{id}`
- `PUT /api/catalog/settings`
- `GET /api/reports/sales`

## Admin API

Admin API calls use:

```http
Authorization: Bearer <admin-token-source-value>
```

In production, only the SHA-256 hash of `admin:<admin-token-source-value>` should be stored in `ADMIN_TOKEN_HASH`.

Endpoints:

- `GET /api/admin/summary`
- `POST /api/admin/companies`
- `POST /api/devices/register`
- `GET /api/admin/products`
- `POST /api/admin/products`
- `GET /api/admin/print-jobs`
- `POST /api/admin/print-jobs`
- `POST /api/admin/print-jobs/{id}/release`
- `GET /api/admin/users`
- `POST /api/admin/users/{id}/reset-password`

## Data Integrity

- Registration, invoice creation, and catalog decimal conversion use D1 batch operations.
- Invoice number and idempotency keys prevent duplicate print-job creation on retries.
- D1 migrations include integrity guards for roles, statuses, prices, quantities, invoice totals, and product decimal places.
- Request validation returns a stable JSON error shape with `code`, localized `message`, `fieldErrors`, and `requestId`.

## Current Limitations

- No Amego API integration yet.
- Print job payloads can still be created manually from admin input for testing.
- The complete official electronic invoice QR code payload is still pending.
- Separate staging and production D1 databases can be revisited before real customer data goes live.
