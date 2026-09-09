# Recorded Tenderly responses

Golden fixtures for `test/unit/tenderly-fixtures.spec.ts`: raw answers of the real Tenderly project to a
handful of representative simulations, so the simulation path is checked against what Tenderly sends
rather than against responses written by hand. Record or refresh them with

    npm run fixtures:tenderly

with `TENDERLY_ACCESS_KEY`, `TENDERLY_ACCOUNT_SLUG` and `TENDERLY_PROJECT_SLUG` set (or in `.env`). The
two stateless scenarios (`effect-free`, `revert`) record with the key alone; the three that move assets
need `FIXTURE_SENDER` and the variables listed in `scripts/record-tenderly-fixtures.ts`. The access key is
never written here. The spec skips itself while this directory holds no `.json` file.
