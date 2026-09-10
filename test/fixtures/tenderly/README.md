# Recorded Tenderly responses

Golden fixtures for `test/unit/tenderly-fixtures.spec.ts`: raw answers of the real Tenderly project to a
handful of representative simulations, so the simulation path is checked against what Tenderly sends
rather than against responses written by hand. Record or refresh them with

    npm run fixtures:tenderly

with `TENDERLY_ACCESS_KEY`, `TENDERLY_ACCOUNT_SLUG` and `TENDERLY_PROJECT_SLUG` set (or in `.env`). The
two stateless scenarios (`effect-free`, `revert`) record with the key alone; the three that move assets
need `FIXTURE_SENDER` (an address holding MANA with the marketplaces approved) and, for the purchase, `FIXTURE_TRADE_ID` from an open Polygon listing (`GET /v1/orders?status=open` on the marketplace API); see `scripts/record-tenderly-fixtures.ts`. `--dry-run` builds the requests without calling Tenderly. The access key is
never written here. The spec skips itself while this directory holds no `.json` file.
