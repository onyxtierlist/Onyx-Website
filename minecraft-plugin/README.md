# ONYX PLAYED Sync — Minecraft plugin

This Paper/Spigot-compatible plugin automatically sends a player to the ONYX `PLAYED` database every time they join the Minecraft server.

## What it does

When `Steve` joins, the plugin sends:

```json
{"name":"Steve","uuid":"..."}
```

to:

`POST /api/players/played`

The ONYX website then stores/updates that player in `played-players.json`.

## Install

1. Build this plugin against the Paper/Spigot API version used by your server.
2. Put the resulting `OnyxPlayedSync.jar` in your server's `plugins/` folder.
3. Start the Minecraft server once.
4. Open `plugins/OnyxPlayedSync/config.yml`.
5. Set `api-url` to your ONYX server's URL. If ONYX is running on the same computer, leave it as:
   `http://127.0.0.1:3000/api/players/played`
6. Set `token` to the same value as the ONYX server's `ONYX_INGEST_TOKEN`.
7. Restart the Minecraft server.

## Important

If the Minecraft server is on a different machine from the ONYX website, `127.0.0.1` is NOT correct. Use the reachable address of the machine running ONYX, for example:

`http://192.168.1.50:3000/api/players/played`

For a remote server, expose the ONYX API securely (prefer HTTPS) rather than opening an unprotected HTTP port to the internet.
