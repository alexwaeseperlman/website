#!/bin/bash
# Pass-value bias experiment: 4 anet PPO variants side by side, all warm-started from the appo iteration-400 net.
#   ./bias_job.sh <appo-400.json> <out root> [iterations=200] [games per thread=16]
# Variants: base (as before), vt (VT=1: value of the move played), soft (SOFT=1: soft pass chain under the policy),
# softvt (both). Each writes <out root>/bias-<v>/log.txt and avs.txt (Alex's test every 25 iterations, with the same
# chain as in training). Upload those as bias-<v>/log.txt and bias-<v>/avs.txt for alexwp.com/train.
here="$(cd "$(dirname "$0")" && pwd)"
INIT_NET="$(realpath "$1")"; ROOT="$2"; T="${3:-200}"; G="${4:-16}"
mkdir -p "$ROOT"; export INIT="$INIT_NET" BETA=207 SAVEEVERY=25 TRAIN_THREADS=32 NOBUILD=1
g++ -O3 -march=native -ffast-math -std=c++17 -pthread "$here/fvi.cpp" -o "$here/fvi"
[ -f "$here/../nash/live.json" ] || python3 "$here/../nash/dequant.py" "$here/../../../public/no_thanks/bot-net.json" "$here/../nash/live.json"
(              "$here/appo_run.sh" "$ROOT/bias-base"   "$T" "$G" 25 20000) &
(VT=1          "$here/appo_run.sh" "$ROOT/bias-vt"     "$T" "$G" 25 20000) &
(SOFT=1        "$here/appo_run.sh" "$ROOT/bias-soft"   "$T" "$G" 25 20000) &
(SOFT=1 VT=1   "$here/appo_run.sh" "$ROOT/bias-softvt" "$T" "$G" 25 20000) &
wait
