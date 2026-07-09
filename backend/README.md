# OpenvoKao Backend

Cloudflare Workers + D1 backend for the OpenvoKao iOS print terminal.

## What This Backend Does

- Provides a simple admin web page at `/`.
- Stores companies, stores, devices, products, invoices, print jobs, and print logs in D1.
- Gives iOS devices a token-based API for reading pending print jobs.
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

Run locally:

```sh
npx wrangler dev --var ADMIN_TOKEN:local-admin-token
```

Open:

```text
http://localhost:8787
```

Use `local-admin-token` in the admin page.

## Cloudflare Setup

Create the D1 database:

```sh
npx wrangler d1 create openvokao-db
```

Copy the returned `database_id` into `wrangler.toml`.

Apply remote migrations:

```sh
npm run d1:migrate:remote
```

Set the admin token:

```sh
npx wrangler secret put ADMIN_TOKEN
```

Deploy:

```sh
npm run deploy
```

## iOS API

iOS uses a device token returned by `POST /api/devices/register`.

All iOS API calls use:

```http
Authorization: Bearer <device-token>
```

Endpoints:

- `GET /api/devices/me`
- `GET /api/print-jobs/pending`
- `GET /api/print-jobs/{id}`
- `POST /api/print-jobs/{id}/printed`
- `POST /api/print-jobs/{id}/failed`

## Admin API

Admin API calls use:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

Endpoints:

- `GET /api/admin/summary`
- `POST /api/admin/companies`
- `POST /api/devices/register`
- `GET /api/admin/products`
- `POST /api/admin/products`
- `GET /api/admin/print-jobs`
- `POST /api/admin/print-jobs`

## Current Limitations

- No real user login yet.
- No password hashing yet.
- No Amego API integration yet.
- Print job payloads are created manually from admin input for now.
- The complete official electronic invoice QR code payload is still pending.
