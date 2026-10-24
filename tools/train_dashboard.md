# Live training dashboard (alexwp.com/train/)

`public/train/index.html` polls Supabase every 20 s and draws whatever training boxes upload. To get a run on it:

## 1. Upload rows

Everything goes into `public.nothanks_train_upload(name text primary key, body text, at timestamptz)` in the Turns
project, through the token-checked RPC (the token is in the function body; ask for it, never commit it):

```sh
put() {  # put <name> <file>   (upserts; `at` becomes now())
  python3 -c 'import json,sys; print(json.dumps({"tok":sys.argv[1],"n":sys.argv[2],"b":open(sys.argv[3]).read()}))' \
    "$TOK" "$1" "$2" > /tmp/put.json
  curl -sS -X POST "$SB/rest/v1/rpc/nothanks_train_put" -H "apikey: $KEY" -H "Content-Type: application/json" \
    --data @/tmp/put.json > /dev/null
}
# SB=https://wgysofnocxigucqocxed.supabase.co  KEY=<publishable key from public/no_thanks/index.html>
while sleep 60; do put ppo/log.txt log.txt; done &    # re-upload logs every 1-2 min while training
```

The page reads them through `public.train_dash()` (`tools/supabase/train_dash.sql`), which anyone can call, so:

- **Anything whose name contains `setup` is never shown.** Put `set -x` / onstart logs (they echo the token) there.
- **`*.json` bodies are never shown** (checkpoints); the page only lists their names and times.
- Bodies over 1 MB are cut to their last 1 MB.

## 2. Name rows by run

| Run | Rows the page reads |
| --- | --- |
| PPO (`deep ppo`) | `ppo/log.txt` (stdout; `iter N/M: … edge vs opponents +x%, entropy x, value mse x, clipped x%, Ns` lines), `ppo/deep-ppo-…-<iter>.json`, `ppo-info`, `ppo-exit` |
| Nash FVI (`fvi/run_all.sh`) | `fvi/log.txt` (run_all's log.txt), `fvi/aloss<k>.csv` (`step,examples_seen,train_rmse,heldout_rmse`), `fvi/a<k>.json`, `fvi-info`, `fvi-run-tail` |

Elapsed time starts at the run's oldest row, so overwrite the `*-info` row when starting a fresh run (or clear the old
rows). A new kind of run needs a prefix, a parser and a view in `public/train/index.html` (`RUNS`, `runOf`, `view*`).

## 3. Keep the `boxes` row current

Whoever rents or destroys a machine updates the row `boxes`: a JSON array of
`{id, job: "fvi"|"ppo", threads, dph, status: "running"|"destroyed", since, until}` (ISO times). The page uses it for
the machines table, $/hr and cost, and shows a job as stopped once its box is `destroyed`. Without it the page falls
back to an editable rate and calls a run idle after 12 minutes without uploads.
