# OnyxPvPBridge 1.1.4

Companion plugin for OnyxPvP 1.1.3.

Features:
- `/elo set <player> <mode> <amount>` for admins with `onyxpvp.admin`.
- Queue aliases: `nethop` -> `nethpot`, `pot` -> `diapot`.
- Sends match ELO/tier changes to the ONYX website API.
- Shows large VICTORY/DEFEAT titles after ranked matches.

Install this JAR **alongside** OnyxPvP 1.1.3; do not remove OnyxPvP.

Configure `config.yml` with the Render backend URL and the same `ONYX_INGEST_TOKEN` used by the backend.


## ONYX tier points / ELO thresholds

Official website points are: LT5 1, HT5 2, LT4 3, HT4 4, LT3 6, HT3 10, LT2 20, HT2 30, LT1 45, HT1 60.
The bridge uses the same proportions for ELO with 1 point = 1000 ELO: 1000, 2000, 3000, 4000, 6000, 10000, 15000, 30000, 45000, 60000.
