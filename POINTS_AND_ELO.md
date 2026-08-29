# ONYX Tier Points & ELO Scale

Official website points:

| Tier | Points | ELO threshold |
|---|---:|---:|
| LT5 | 1 | 1000 |
| HT5 | 2 | 2000 |
| LT4 | 3 | 3000 |
| HT4 | 4 | 4000 |
| LT3 | 6 | 6000 |
| HT3 | 10 | 10000 |
| LT2 | 15 | 15000 |
| HT2 | 30 | 30000 |
| LT1 | 45 | 45000 |
| HT1 | 60 | 60000 |

The ELO thresholds preserve the exact point proportions using 1 point = 1000 ELO.

The website now calculates tier-test points from the tier name server-side. Existing PostgreSQL ONYX records are normalized to these values when the server starts.

The included OnyxPvPBridge config contains the same ELO thresholds and the bridge now reads those thresholds from its own config. If your separate main OnyxPvP plugin has its own `elo.tiers` section, merge `ONYXPVP-ELO-CONFIG.yml` into that config as well.
