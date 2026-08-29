# ONYX admin security

## Never put admin passwords in GitHub
The admin username/password hash and session secret live in `.env`, which is ignored by Git.
Run `SETUP_ADMIN.bat` locally to create `.env`.

The password itself is never stored. The server stores a salted `scrypt` hash and verifies it with Node's built-in crypto module.

## GitHub / production hosting
GitHub Pages is static hosting; it cannot securely run the ONYX Node backend or store admin credentials. Keep `server.js` on a backend host and set these environment variables in that host's secret/environment settings:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET`
- `ONYX_INGEST_TOKEN` (only if the Minecraft plugin needs it)
- `FRONTEND_ORIGIN` (only when the frontend is on another origin)

Do not commit `.env`.

## Sessions
After login, the server gives the browser an HttpOnly session cookie. The password is not sent again for admin API calls. Sessions expire after 12 hours and are kept in server memory.

For a multi-instance production deployment, replace the in-memory session Map with a shared session store such as Redis or your database.
\n\n### Admin delete\nThe admin DELETE endpoint uses the authenticated HttpOnly admin session. The private ONYX ingest token is intentionally not required in the browser admin flow and must never be exposed to client-side JavaScript.\n