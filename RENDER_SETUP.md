# ONYX Website — Render setup

## The current failure

If Render shows:

`getaddrinfo ENOTFOUND dpg-...`

the Node app built correctly, but `DATABASE_URL` points to a PostgreSQL hostname that no longer resolves. This is usually a stale/deleted Render database URL.

## Fix it in Render

1. Open the **active PostgreSQL database** you want this website to use.
2. Copy its **current Internal Database URL** (if the web service and database are both on Render) or its current External/connection URL if using another provider.
3. Open the **ONYX website Web Service**.
4. Go to **Environment**.
5. Replace the existing `DATABASE_URL` value with the current database URL.
6. Keep `DATABASE_SSL` unset unless your database specifically requires a non-TLS connection.
7. Save changes and redeploy.

Do NOT put a plain password, old hostname, or a URL from a deleted Render database into the new value.

## Start command

The repository already has:

`npm start`

which runs:

`node server.js`

Render may also run this through Yarn; that is fine because the package has the same start script.

## Health check

After redeployment, open:

`https://YOUR-RENDER-SERVICE.onrender.com/health`

A healthy service returns JSON containing:

`"ok": true`

and:

`"database": "ready"`

If it says `database: "not_ready"`, check `DATABASE_URL` again.

## Important

The website is designed to use PostgreSQL as persistent storage. Do not replace the database with an in-memory fallback if you want tier-test/player changes to survive Render restarts.
