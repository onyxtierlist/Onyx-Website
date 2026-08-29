# Render PostgreSQL fix for `getaddrinfo ENOTFOUND dpg-...`

This error means Node's `pg` client is trying to resolve a PostgreSQL hostname that is no longer valid/reachable. The website reads `process.env.DATABASE_URL`, so the fix is in Render's environment configuration, not `npm install`.

1. Open your Render PostgreSQL database.
2. Open **Connect** and copy the current **Internal Database URL**.
3. Open the Onyx web service -> **Environment**.
4. Edit `DATABASE_URL` and replace the old value with the current Internal Database URL.
5. Make sure the web service and Postgres database are in the same Render account and region.
6. Save and deploy.

Do not paste the database URL into GitHub or commit it to `.env`.

If the database was deleted/recreated, the old `dpg-...` hostname can remain in the web service's environment variable even though the app code is correct.

The website uses `DATABASE_URL` directly and defaults PostgreSQL TLS on unless `DATABASE_SSL=false` is set. For a Render service using the internal URL, you can normally set `DATABASE_SSL=false`.
