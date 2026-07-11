# OpenvoKao

OpenvoKao is an iOS print-terminal app plus a Cloudflare Workers/D1 backend for managing companies, products, invoices, print jobs, and thermal-printer workflows.

## Architecture

- `openvoKao/`: SwiftUI iOS app. It handles login, device binding, printer selection, pending print jobs, ESC/POS receipt rendering, print status callbacks, and local retry state.
- `openvoKaoTests/`: iOS unit tests for receipt rendering, printer transport behavior, backend client behavior, and app-state workflows.
- `backend/`: Cloudflare Worker API, D1 migrations, admin page, integration tests, and deployment scripts.
- `docs/`: operational notes such as Cloudflare observability setup.
- `todo2.md`: detailed engineering risk and remediation checklist.

## Data Flow

1. A customer registers or logs in through the app/backend flow.
2. The backend owns company, user, product, category, invoice, print-job, and device data in D1.
3. The iOS app binds to a company as a print device and receives only the pending jobs it is allowed to claim.
4. A device claims one print job at a time, prints through BLE ESC/POS, then reports `printed` or `failed`.
5. The backend records audit logs and keeps idempotency keys so retries do not create duplicate invoices or print jobs.

## Print State Machine

- `pending`: created by backend, not yet claimed.
- `printing`: leased by one device for printing.
- `printed`: device reported successful print.
- `failed`: device reported failure and saved an error message.

Claiming uses lease fields so two iPhones do not print the same job at the same time.

## Backend Commands

```sh
cd backend
npm install
npm run types:wrangler:check
npm run typecheck
npm test
npm run test:migrations
npm run dry-run
```

Local Worker:

```sh
cd backend
npx wrangler dev --var ADMIN_TOKEN:local-admin-token
```

Deploy:

```sh
cd backend
npm run deploy
```

## iOS Commands

Official app identity:

- Bundle ID: `com.kaochifeng.openvoKao`
- Apple Team ID: `6T25FRDJW3`

Build without signing, useful for CI:

```sh
xcodebuild -project openvoKao.xcodeproj -scheme openvoKao -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

Run tests:

```sh
xcodebuild test -project openvoKao.xcodeproj -scheme openvoKao -destination 'platform=iOS Simulator,name=iPhone 16'
```

## Secrets

- Amego App Key should stay on the backend side and must not be saved by iOS.
- Production admin access should use `ADMIN_TOKEN_HASH`, not plaintext `ADMIN_TOKEN`.
- Device tokens and auth sessions are stored as hashes in D1 where possible; iOS should keep usable tokens in Keychain.
- Build outputs such as `.ipa` files should be distributed through releases or CI artifact storage, not committed to Git. CI uploads the unsigned simulator app as `openvoKao-unsigned-simulator-app`.

## Deployment Notes

The Worker config lives in `backend/wrangler.jsonc`. Because the product is not officially live yet, the current D1 database is used for development/testing. Revisit separate staging and production databases before real customer data goes live.
