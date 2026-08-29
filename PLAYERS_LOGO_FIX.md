# ONYX Players + Logo Fix

Fixed the two issues seen on the Render Players page:

1. Navbar logo:
   - Added `assets/onyx-logo.png` as a reliable static fallback.
   - HTML pages now use the PNG logo.
   - `server.js` also correctly serves SVG as `image/svg+xml`.

2. Player skins:
   - Players page now uses the full-body skin render when a UUID is available.
   - The skin is constrained inside a fixed avatar frame.
   - Added `object-fit`/size rules so skins cannot stretch into other table rows.
   - A square avatar endpoint is used as the image fallback.

No database/API behavior was changed.
