# Ace Tier List

Double-click `START_ACE.bat`.

The server fetches the live MCPVP tiers page and parses every player row server-side, then exposes the result at `/api/mcpvp`. This avoids browser CORS and avoids depending on an undocumented JSON shape.

If the site still says unavailable, open `http://localhost:3000/api/mcpvp`. It should show JSON containing `count` and a `players` array. If that endpoint itself fails, the issue is network access from Node to MCPVP rather than the website UI.


## Current MCPVP loader

The local Node server first requests the official `https://www.mcpvp.com/tiers/data` JSON endpoint. If that response cannot be parsed into player records, it requests the official `https://www.mcpvp.com/tiers` page and parses its player rows server-side.

The browser only talks to `http://localhost:3000/api/mcpvp`, so CORS/browser parsing is no longer part of the data path.

For troubleshooting, double-click `TEST_MCPVP.bat` after starting `START_ACE.bat`. It prints the actual server response.


### TEST_MCPVP.bat clarification

`TEST_MCPVP.bat` tests the local Ace server at `http://localhost:3000/api/mcpvp`.
You must start `START_ACE.bat` first and leave its server window running.

If you run the test by itself, `ECONNREFUSED` simply means nothing is listening on port 3000.


## Separate PLAYED database

`played-players.json` is now the source of truth for players who have actually joined/played on the ONYX server.

- `GET /api/players/played` → every player who has played.
- `POST /api/players/played` → add/update a player when they join.
- `GET /api/onyx/players` → only players who have been tier tested.
- `POST /api/onyx/player` → creates a tier-list record only if that player already exists in the PLAYED database.
- `POST /api/onyx/test` → stores a tier test for a tier-tested player.

Your Minecraft server/plugin can call `POST /api/players/played` whenever a player joins. This keeps "played on the server" completely separate from "tier tested".

## Automatic Minecraft PLAYED sync

The project now includes `minecraft-plugin/OnyxPlayedSync`, a Paper/Spigot-compatible plugin. It listens for `PlayerJoinEvent` and automatically POSTs the player's Minecraft name and UUID to the PLAYED database.

The included `START_ACE.bat` sets the local API token to `onyx-local-sync-7f4c9d2a`. Put the same token in the plugin's `config.yml`.

If Minecraft and ONYX run on the same PC, use the default `http://127.0.0.1:3000/api/players/played`. If they run on different machines, change the plugin's `api-url` to the ONYX machine's reachable address.

The plugin source is in `minecraft-plugin/`. Build it against the Paper API version matching your Minecraft server, then put `OnyxPlayedSync.jar` in the server's `plugins` folder.


## Minecraft premium skin sync

ONYX now resolves Minecraft Java players against Mojang's official session profile API using their UUID.

- Players with a Mojang-resolvable UUID are marked `premium: true`.
- Their Mojang skin texture is cached in the player database.
- The website shows the Minecraft head for premium players on leaderboards, the Players page, and profiles.
- Skin lookups are cached for 24 hours to reduce API traffic.
- Players without a Mojang-resolvable profile are shown without a skin rather than being given a fake/default premium skin.
- The join-sync plugin triggers the lookup automatically when a player joins.


### Skin fix
The skin resolver now accepts either a UUID from the Minecraft plugin or a Java username, resolves the username through Mojang, and stores the resolved UUID/skin URL. Played-only players also use their own cached skin data.


### Character render
Premium players now display as an actual rendered Minecraft character using Crafatar's `/renders/body/{uuid}` endpoint, rather than displaying the raw skin texture file.


### Avatar reliability fix
The UI now uses the MC Heads rendered player-head endpoint as the primary image source, with Crafatar as a browser-side fallback. This avoids displaying the raw skin PNG or a broken image icon.


### Full-body player render
The premium player image now uses MC-Heads' documented `/player/{uuid}` full-body endpoint. The whole Minecraft character is rendered from the player's UUID rather than using the raw skin texture or just the head.


### Overall ranking fix
The Overall tab now aggregates the players' actual kit tiers instead of sorting the entire list by ONYX points. Tier order is HT1 > LT1 > HT2 > LT2 > HT3 > LT3 > HT4 > LT4 > HT5 > LT5. ONYX points remain as a secondary tie-breaker.


### Copyright footer
A copyright/disclaimer footer has been added to every HTML page, including the admin page and reference page.


## Admin login and GitHub safety

Admin access is protected by a server-side login. Run `SETUP_ADMIN.bat` once to create a private `.env` file. The password is stored only as a salted Node `scrypt` hash; the plaintext password is never written to disk. `.env` is included in `.gitignore`, so it should not be committed to GitHub.

The Minecraft plugin ingest token is also generated randomly by `SETUP_ADMIN.bat`. Put that token into the actual plugin `config.yml` on your Minecraft server; the repository only contains a placeholder.

**Do not put admin passwords, password hashes, session secrets, or ingest tokens into `config.js`, HTML, JavaScript, or any GitHub-tracked file.**

For production, host `server.js` on a backend service that supports environment variables/secrets. GitHub Pages can host the public frontend, but it cannot securely run this Node backend. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, and `ONYX_INGEST_TOKEN` as backend environment secrets.


## Persistent PostgreSQL storage (Render-safe)

ONYX now stores its live data in PostgreSQL instead of writing changes back to `onyx-db.json` and `played-players.json`.

The server requires the `DATABASE_URL` environment variable. On Render, add `DATABASE_URL` to the service's Environment settings and point it at a PostgreSQL database you want to keep permanently. The application automatically creates its two storage tables on startup.

On the first startup, if the PostgreSQL tables are empty, ONYX imports the existing `onyx-db.json` and `played-players.json` files as seed data. After that, all changes are written to PostgreSQL. The JSON files are no longer used as live storage, so Render restarts/spin-downs cannot erase newly saved tier or played-player data.

**Important:** Render's temporary/free PostgreSQL offerings may have their own expiration or limits. For permanent ONYX data, use a PostgreSQL provider/plan with persistence that matches your needs. The app is compatible with any standard PostgreSQL connection URL.

### Render environment variables

Set these in Render's Environment settings (do not commit them to Git):

- `DATABASE_URL` — your PostgreSQL connection string.
- `DATABASE_SSL` — leave unset for normal hosted PostgreSQL; set to `false` only for a database that explicitly does not require TLS.

Your existing `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `ONYX_INGEST_TOKEN`, and optional `FRONTEND_ORIGIN` variables remain unchanged.

### Ranked PvP sync

`POST /api/pvp/match` accepts `{name, uuid, kit, elo, rank}` with the same `X-Onyx-Token` ingest header used by the PLAYED sync. The endpoint maps `nethpot` → `nethop`, `diapot`/`pot` → `pot`, and writes the player's current PvP ELO/tier into the PostgreSQL-backed ONYX ranking record.
