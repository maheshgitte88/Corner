# Counter — Inventory & POS

A standalone React + Express + MongoDB application for a physical retail shop. This folder is independent of the existing interview application.

## Features

- Admin login with bcrypt passwords and an eight-hour JWT in an HttpOnly cookie.
- Dashboard with sales, stock alerts and recent invoices.
- Product create/edit/archive, unique SKUs, barcode search, categories and optional S3 images.
- Stock adjustments with mandatory reasons and a transaction history.
- POS with weighted quantities (three decimals), item discounts, flat/percentage bill discounts, optional customers and five payment methods.
- Atomic sale creation, inventory deduction, invoice sequence and movement records.
- Idempotent checkout retries; cancellation restores stock atomically and only once.
- Immutable product/customer/shop snapshots on invoices; A4 and 80 mm print layouts.
- Invoice history, date/payment filtering, customer purchase history, sales reports and shop settings.

## Requirements

Node.js 22+ and MongoDB Atlas or a MongoDB replica set. A standalone MongoDB process is deliberately rejected: stock and invoice changes require transactions. AWS S3 is optional. No credentials from the parent project are used.

## Try it immediately

Run `npm install` then `npm run demo`. Open http://localhost:4100. The terminal prints a randomly generated local demo login; it is also saved in the ignored `.local-demo/.env` file. This starts a real, isolated MongoDB replica set with seed products, so billing and stock writes work end to end. The first run downloads a MongoDB binary. Demo data resets when you stop it; use the setup below for permanent shop data.

## Setup

From this directory:

```powershell
npm install
Copy-Item server/.env.example server/.env
```

Edit `server/.env` locally:

- `MONGODB_URI`: dedicated database on Atlas or a local replica set.
- `JWT_SECRET`: at least 32 random characters; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: your admin login; password must be at least 12 characters.
- `CLIENT_URL`: `http://localhost:5174` for development.
- Optional `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`.

Never put secrets in the client, source control, screenshots or support messages. The `.env` file is ignored.

```powershell
npm run seed
npm run dev
```

Open http://localhost:5174 and sign in using the configured admin credentials. The backend listens on port 4100; Vite proxies `/api` to it. The seed creates 10 products in five categories with normal, low and zero stock. It preserves existing products, settings and passwords. Seed only a demo database if you do not want sample products in your real inventory.

To install/start separately: `npm install -w server`, `npm install -w client`, `npm run dev -w server`, `npm run dev -w client`.

## MongoDB locally

Install MongoDB Community, create a dedicated data directory, start `mongod --replSet rs0 --bind_ip 127.0.0.1 --dbpath <your-data-directory>`, then use `mongosh --eval "rs.initiate()"`. Use the connection string in `.env.example`. Atlas already supports transactions. For deployment, use database authentication, TLS and restricted network access.

## Optional images

Allow the backend's IAM identity `s3:PutObject` only under `products/*` in the chosen bucket. Use an HTTPS CDN/public media URL for those non-sensitive product images, or configure a suitable bucket read policy. Uploads do not change bucket permissions or set public ACLs. Set `S3_PUBLIC_BASE_URL` to your CDN base URL when applicable. Only PNG, JPEG and WebP files up to 5 MB are accepted; file signatures and MIME type must agree. Credentials stay server-side, and IAM role credentials also work through the AWS SDK default provider chain. Removing a product image removes its database reference; object retention/cleanup is managed with your bucket lifecycle policy.

## Build and run for production

```powershell
npm run build
# Set NODE_ENV=production and CLIENT_URL=https://your-shop-domain in server/.env
npm start
```

Express serves the built frontend and `/api` from the same origin. Put it behind an HTTPS reverse proxy; production cookies require HTTPS. Forward the original `Origin` header and configure the exact public origin. Do not put this application directly on plain HTTP in production. Start with a process supervisor/service and configure MongoDB backups and restore testing. The default rate limiter uses process memory; a multi-instance deployment should use a shared limiter store. Configure proxy trust explicitly for your own infrastructure before relying on forwarded client IP addresses; the app does not blindly trust forwarded headers.

No payment gateway is involved. Cash/UPI/card/bank/other payments are recorded, not processed. A cancellation records invoice reversal and restocks goods; staff must handle any actual refund separately. Partial returns and payment settlements for outstanding balances are outside this MVP.

## Money, stock and invoices

All API money fields are integer paise; the UI accepts/displays rupees. Decimal.js calculates fractional quantity extensions and taxes, rounding half-up to paise. Item discounts are applied first, then bill discounts are allocated proportionately, then per-line GST is applied to the discounted taxable amount. Stored line totals reconcile with invoice totals. No automatic whole-rupee rounding is applied; `roundOff` is zero. Unit prices are tax-exclusive. This MVP records a single GST percentage; it does not generate CGST/SGST/IGST tax compliance filings.

Each checkout submits a UUID and retries an identical payload with the same UUID. The server validates the payload hash, current product prices, activity and stock. All writes occur in a MongoDB transaction. Concurrent updates trigger MongoDB retries and are revalidated. A checkout with a changed payload must use a new key. Do not change a bill after an uncertain network response until checking invoice history. Cancelling uses the stored quantities and cannot restore stock twice. Products are archived, never deleted, so old invoices remain readable.

For pcs/box/packet/custom, quantities must be whole numbers; kg/gram/litre/ml allow three decimals. The stock screen is the only way to adjust existing stock. Correction sets an absolute quantity; Added/Returned/Other increase it and Reduced/Damaged decrease it. Changing a unit requires zero stock first. Aggregate inventory quantity combines unlike units and should be treated only as an operational count.

Reports use Asia/Kolkata calendar dates, sum completed invoices and exclude cancellations. Historical period totals consequently change when a sale is cancelled later. Save/select a customer in Customers before checkout to link purchase history; one-off entered details are invoice snapshots only. Customer fields are optional for walk-in sales.

Printing: open any invoice, select A4 or 80mm, then Print / save PDF. Choose the corresponding paper in your printer settings and disable browser headers/footers. For thermal printers use 80 mm roll paper and minimal margins. Printing shows only the invoice.

## Source map

- `server/src/models.js`: Mongoose models and indexes.
- `server/src/validations.js`: request schemas and business input constraints.
- `server/src/services.js`: atomic checkout, cancellation and stock ledger.
- `server/src/routes.js` and `server/src/routes/`: authentication and modular catalogue, sales/report, and upload handlers.
- `server/src/app.js`: security middleware, cookies, routing and centralized errors.
- `server/src/config.js`, `server.js`, `seed.js`: environment, startup and seed.
- `shared/billing.js`: shared decimal-safe calculations (server remains authoritative).
- `client/src`: reusable components and page modules with fetch-based integration.
- `tests`: calculation and API integration tests.

Management endpoints: `/api/products`, `/api/products/:id/stock`, `/api/categories`, `/api/customers`, `/api/inventory/transactions`, `/api/invoices`, `/api/invoices/:id/cancel`, `/api/dashboard`, `/api/reports/sales`, `/api/settings`, `/api/upload/product-image`. All require login. Login/logout/me are under `/api/auth`. Financial and stock updates reject invalid inputs. `/api/health` is a public process health endpoint.

## Verification

```powershell
npm test
npm run build
```

The integration tests use an ephemeral MongoDB replica set and never connect to the configured shop database. On the first run mongodb-memory-server may download a MongoDB binary. See `VERIFICATION.md` for the checks actually run in this workspace.

## Operating limits

This is a single-shop, one-admin-role MVP. Lists currently fetch all products/customers/invoices; add server pagination before using a very large catalogue or multi-year high-volume ledger. The stock history dialog shows the most recent 500 movements. An outstanding balance is recorded but there is no debt-collection or later-payment module. S3 and your actual printer must be verified in your own environment. Configure real credentials, backups, HTTPS and operational monitoring before serving real sales.

