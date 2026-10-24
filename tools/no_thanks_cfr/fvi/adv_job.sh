#!/bin/bash
# Auxiliary advantage head experiment (Alex 2026-10-24): 4 anet PPO runs with ADV=1, warm-started from appo iteration 400.
#   ./adv_job.sh <appo-400.json> <out root> [iterations=200] [games per thread=16]
# Variants: adv (hard chain, head LR 1e-3), advsoft (soft chain, 1e-3), advsoft-lo (3e-4), advsoft-hi (3e-3).
# Each writes <out root>/adv-<v>/log.txt and avs.txt (Alex's test every 25 iterations). Upload those as
# adv-<v>/log.txt and adv-<v>/avs.txt for alexwp.com/train.
here="$(cd "$(dirname "$0")" && pwd)"
INIT_NET="$(realpath "$1")"; ROOT="$2"; T="${3:-200}"; G="${4:-16}"
mkdir -p "$ROOT"; export INIT="$INIT_NET" BETA=207 SAVEEVERY=25 TRAIN_THREADS=32 NOBUILD=1 ADV=1
g++ -O3 -march=native -ffast-math -std=c++17 -pthread "$here/fvi.cpp" -o "$here/fvi"
[ -f "$here/../nash/live.json" ] || python3 "$here/../nash/dequant.py" "$here/../../../public/no_thanks/bot-net.json" "$here/../nash/live.json"
(                 "$here/appo_run.sh" "$ROOT/adv-adv"        "$T" "$G" 25 20000) &
(SOFT=1           "$here/appo_run.sh" "$ROOT/adv-advsoft"    "$T" "$G" 25 20000) &
(SOFT=1 ALR=3e-4  "$here/appo_run.sh" "$ROOT/adv-advsoft-lo" "$T" "$G" 25 20000) &
(SOFT=1 ALR=3e-3  "$here/appo_run.sh" "$ROOT/adv-advsoft-hi" "$T" "$G" 25 20000) &
wait
