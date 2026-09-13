# Counter Cloud — multi-client retail SaaS

Counter now has a platform administration layer and an isolated retail workspace for each client. Platform administrators onboard clients, define monthly/yearly packages, record payments, renew subscriptions and manage access. Client shop administrators manage their own products, stock, customers, invoices and staff. Cashiers can create bills and view retail records.

## Try the full application

```powershell
npm install
npm run demo
```

Open http://localhost:4100. The terminal prints **two separate logins**: platform administrator and demo shop owner. Generated credentials are stored in ignored `.local-demo/.env`. The demo runs a real MongoDB replica set and seeds three packages plus one client with ten products. Its database resets when the demo stops. No email or payment is sent.

## Permanent setup

Requirements: Node.js 22+, MongoDB Atlas or a replica set, an HTTPS domain/reverse proxy for production, and optional Cloudinary or AWS S3 image storage.

```powershell
npm ci
Copy-Item server/.env.example server/.env
```

Edit `server/.env` locally:

- `MONGODB_URI`: the **platform database** on an authenticated MongoDB replica set. Use a dedicated cluster/application database prefix; do not reuse another application's environment file.
- `JWT_SECRET`: a random string of at least 32 characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`: a separate platform account with a strong 12+ character password.
- `CLIENT_URL`: `http://localhost:5174` for development or your exact HTTPS public origin in production.
- `SEED_DEMO=false` for real deployments. `ADMIN_EMAIL`/`ADMIN_PASSWORD` are only used for the optional disposable demo client.
- Image-provider and compression variables described below.

```powershell
npm run seed
npm run dev
```

Open http://localhost:5174 and log in with the platform admin credentials. Seed creates the platform administrator and Starter/Growth/Business packages. Existing accounts, passwords and package edits are preserved; clients and products are only seeded when `SEED_DEMO=true`.

## Platform workflow

1. Open **Packages** to set monthly/yearly prices in INR, active-product and active-user limits, and reports/image-upload features. Default prices are sample business terms: edit them before onboarding real clients.
2. Open **Clients → Onboard client**. Enter business name, unique workspace code, owner identity and a temporary password. Email addresses are globally unique across all accounts. Choose a package and billing cycle.
3. For paid activation, record the actual payment method and reference. The package price is recorded as fully received. For a free trial, enter 1–30 trial days; the initial acknowledgement records ₹0.
4. Share the login through your own secure channel. New client owners and team members must change temporary passwords before opening the workspace. No email integration or automatic email is assumed.
5. Open **Manage → Subscription** to record a renewal. **Extend** adds a period to the existing expiry (or starts today if expired) and requires the same package and cycle. **Replace** starts a different package/cycle immediately; remaining time is discarded, with no proration or automatic refund. The UI explains this choice.
6. Open **Manage → Overview** to suspend or reactivate a workspace. Renewing a suspended client does not automatically reactivate it.
7. **Payments** contains printable payment acknowledgements with immutable client, package, price and period snapshots. **Audit log** records the latest 200 platform/team administrative events.

Payments and renewals are **manually recorded**, as requested. There is no gateway, recurring debit, dunning email, partial subscription payment, subscription tax computation or automatic refund. The receipt is a payment acknowledgement, not a tax invoice. Wrong payment entries require an operational correction procedure; the app deliberately provides no silent deletion of receipts.

## Client workflow

Owners sign in using the same application URL and are routed to their own shop. They can manage catalogue, categories, stock, customers, POS, history, printing and settings. **Team** creates shop administrators or cashiers and deactivates/reactivates staff. Package limits count active products and active accounts, including the owner. Archived products and inactive team members free capacity. The owner cannot be deactivated through the team screen. Password resets revoke existing sessions and require a new password at sign-in.

**Subscription** shows the saved plan, expiry, usage and the owner's payment history. Expired/suspended clients keep read access to their existing records and can change their password, but server-side checks reject sales, edits, uploads and team mutations. Feature restrictions remain in effect. Expiry is checked on each request, so no scheduler is required. Contact the platform administrator to renew.

Existing retail functionality remains: decimal-safe prices, weighted quantities, item/bill discounts, tax-exclusive GST, atomic checkout, inventory ledger, duplicate checkout protection, invoice snapshots, cancellation with stock restoration, A4/80 mm printing, date-filtered history and reports. Products may be simple SKUs or a parent with size/pack variants (each variant has its own SKU, price, stock and optional expiry window). Low stock, out of stock and near-expiry (within 30 days) are tracked per sellable SKU. On POS, entering a mobile that matches a saved customer selects that customer automatically. Subscription receipts are separate from retail invoices and never enter client sales reports.

Package limits count **active sellable products** (standalones and variants). Parent catalogue rows do not consume capacity.

## Isolation and authorization

Platform models (`User`, `Tenant`, `Package`, `SubscriptionPayment`, `AuditEvent`, `PlatformCounter`) live in the platform database. Each tenant's products/categories/customers/invoices/stock/settings/counters live in a separate database named `{8-char platform hash}_{tenant ObjectId}` (33 characters, within Atlas shared-cluster 38-byte limit). The signed-in user's membership determines the database. Request headers, query strings and body fields cannot select another tenant. Client-supplied foreign record IDs are looked up only inside that tenant's database. SKUs, category names and invoice sequences are unique within a client; different clients can use the same SKU or invoice number.

The MongoDB service account therefore needs permission to create/use the platform database and its tenant databases and indexes. All databases share the same MongoDB client/cluster, allowing atomic cross-database onboarding and package-capacity checks. Network access and credentials are server-only. Database-level isolation does not create separate clusters or separate IAM users. Size your Atlas tier for the expected tenant/database/collection count and back up every tenant database plus the platform database. Do not rename the platform database after onboarding: it forms part of the tenant database naming scheme.

Shop middleware rejects platform accounts; platform middleware rejects client accounts. Cashier write access is limited to checkout. Client roles and session version are loaded from the database on every request; role and tenant are not trusted from the JWT or browser. Bcrypt passwords, HttpOnly/SameSite cookies, Helmet, origin checks, validation and rate limits are applied. JWT sessions expire after eight hours. Forced password changes and resets revoke old tokens.

Capacity checks serialize through the tenant record inside a MongoDB transaction, so concurrent product/team creation cannot exceed plan limits. Plan replacements reject downgrades below current usage. Existing subscriptions keep their package snapshot until renewal/replacement; editing or archiving a package does not silently change existing client entitlements.

Monthly/yearly periods use calendar arithmetic with UTC instants and month-end clamping (January 31 → February 28/29; leap-day annual renewals → February 28). The overview's monthly recurring value normalizes current active paid packages; it is an operational subscription metric, not recognized accounting revenue.

## Migrating the original single-shop version

Do not simply start onboarding over a live legacy database. Stop writes and take a verified backup first. Configure a **new, separate** platform admin email and run `npm run seed`. Add these values to `server/.env`:

```dotenv
MIGRATION_OWNER_EMAIL=existing-shop-owner@example.com
MIGRATION_CLIENT_SLUG=existing-shop
MIGRATION_CLIENT_NAME=Existing Shop
MIGRATION_PACKAGE_NAME=Growth
```

Run `npm run migrate:legacy`. It copies the original retail collections into one tenant database, preserving product/invoice/customer IDs, snapshots, counters and stock history. It assigns all unassigned legacy shop users to that tenant, preserves password hashes, revokes sessions and requires a password change. The original retail collections are retained as a backup and no longer served by shop APIs. A 14-day trial is granted; record a payment/renewal to extend it. The migration refuses an existing client slug or a package smaller than existing active usage. The script assumes one legacy shop and a transaction-sized dataset; large migrations need a staged migration plan. It does not merge existing SaaS clients.

## Production deployment

```powershell
npm ci
npm run build
# Set NODE_ENV=production and CLIENT_URL=https://your-domain in server/.env
npm start
```

Express serves the built React application and `/api` from the same origin. Terminate HTTPS at a reverse proxy; production session cookies require HTTPS. Use a supervisor/service, database backups, monitoring and restricted network access. No live cloud deployment is performed automatically.

A Dockerfile and `compose.yaml` are included for deployment against your existing MongoDB replica set/Atlas:

```powershell
docker compose build
docker compose run --rm counter node server/src/seed.js
docker compose up -d
```

The container binds to host loopback port 4100 for your HTTPS reverse proxy, runs as the node user and receives secrets at runtime from `server/.env`. Secrets, local demo files, test binaries and node_modules are excluded from the build context. Docker configuration has not been run in this Windows workspace because Docker is unavailable here.

The current limiter uses per-process memory and the app does not blindly trust forwarded headers. Before scaling to several processes, use a shared rate-limit store and configure proxy trust for the exact infrastructure. Retail and platform lists currently fetch all records; add server pagination before high-volume use. Tenant model handles are cached for the running process. No custom domains, multi-branch shops, email delivery, SSO, 2FA or payment gateway are implemented in this version.

## Image storage: Cloudinary or AWS S3

The same endpoint supports both providers. **Cloudinary is the default**. Configure `server/.env` and restart the backend after changes:

```dotenv
IMAGE_STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# Compression is opt-in; false sends the original bytes unchanged.
IMAGE_COMPRESSION_ENABLED=false
# Used only when compression is true:
IMAGE_COMPRESSION_QUALITY=80
IMAGE_MAX_WIDTH=1600
IMAGE_MAX_HEIGHT=1600
```

With compression enabled, Sharp processes the image **before upload to either provider**: it corrects EXIF orientation, fits within the configured dimensions without enlarging small images, preserves aspect ratio and transparency, and encodes WebP at the selected quality (1–100). Dimensions accept integers from 64–8192 pixels. Compression changes the format/metadata; the size reduction depends on the image. With compression disabled, original bytes, format, dimensions and metadata are sent unchanged; no application-requested Cloudinary transformations are applied. Your Cloudinary account's own upload policies still apply.

Uploads accept still PNG, JPEG and WebP files, at most 5 MB **before processing** and 20 megapixels. The server decodes and validates actual content and MIME type even when compression is off. Animated images are rejected. Tenant authorization and the package's image-upload entitlement apply before file processing.

To switch new uploads to AWS, retain Cloudinary settings if desired and change:

```dotenv
IMAGE_STORAGE_PROVIDER=s3
AWS_REGION=ap-south-1
AWS_S3_BUCKET_NAME=your-bucket
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
# Optional HTTPS CDN base URL:
S3_PUBLIC_BASE_URL=
```

Only the selected provider needs credentials. S3 also supports IAM-role credentials. Objects/public IDs are scoped under `tenants/<authenticated-tenant-id>/products/<random-key>`. Product records retain `imageUrl`, `imageKey` and `imageProvider`. Existing records without provider metadata remain compatible. Switching providers affects **new uploads only**: old URLs are not rewritten or migrated, so keep existing assets available on the previous provider. There is no silent fallback when an upload fails.

For S3, provide the required object-write permissions and an HTTPS CDN/public media URL for non-sensitive catalogue images; uploads do not change policies or ACLs. Cloudinary credentials stay on the backend: never put them in frontend `VITE_` variables. Removing an image removes its database reference; old-object retention/cleanup remains with the storage provider. Products work without images.

## Tests and source

```powershell
npm test
npm run test:saas
npm run build
```

Tests use isolated MongoDB replica sets and do not connect to your shop database. The first run may download MongoDB 8.0.12 into ignored `.mongodb-binaries`. Tests cover retail transaction integrity, cross-tenant access attempts, duplicate onboarding/renewals, plan limits under concurrency, feature/role gates, expiry/suspension, password changes/revocation and calendar billing periods.

Key files: `server/src/platform-models.js`, `tenant-db.js`, `saas-services.js`, `saas-validations.js`, `routes/platform.js`, `routes/team.js`, `routes.js`, `client/src/Platform.jsx`, `Account.jsx`, and `scripts/migrate-legacy.js`. Retail page modules and shared billing calculations remain separate. See `VERIFICATION.md` for checks actually completed and remaining environment verification.

