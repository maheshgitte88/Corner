# Verification — 10 September 2026

## Passed

- `npm run build`: Vite production build succeeded (React frontend, approximately 241 KB JS / 77 KB gzip).
- `npm test`: all 16 tests passed against a real isolated MongoDB 8.0.12 replica set.
- Monetary tests: supplied billing example, fractional weights, item and bill discounts, mixed tax rates, full discount, invalid input, and many one-paise lines.
- API tests: authentication, invalid IDs, hostile Origin rejection, product validation, opening-stock ledger, sale creation and authoritative pricing, duplicate retries, snapshot preservation, cancellation/reprint reads, insufficient-stock rollback, concurrent last-unit sales, simultaneous identical checkouts, weighted stock changes, category/customer/report/settings APIs, invalid image upload and archived-product rejection.
- Failure injection after invoice/stock writes rolled back invoice, quantity and ledger changes.
- Concurrent cancellation requests restored stock only once.
- `npm run demo`: production frontend build, isolated replica set, seed and Express startup succeeded on http://localhost:4100.
- Dependency install reported zero known vulnerabilities at installation time.

## Not verified here

- Your MongoDB deployment, AWS bucket/IAM/CDN configuration or live S3 upload, since your credentials were not supplied to this project.
- A physical A4 or thermal printer. Both print layouts are implemented; select the matching printer paper settings.
- Hosted HTTPS deployment, backups, load testing or multi-instance operation.
- Browser interaction/visual regression testing. The production UI was compiled and opened for review; automated tests exercised the API and calculations.

## Local demo

The currently running demo uses temporary MongoDB storage. Its database resets when stopped. Generated login credentials are stored only in ignored `.local-demo/.env` and printed by the demo launcher. Use `server/.env` with your own MongoDB for durable store data. The existing interview application and its environment were not modified.
