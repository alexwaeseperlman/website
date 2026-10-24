#!/bin/bash
# anet PPO in chunks, with Alex's test vs the live bot after each chunk.
#   ./appo_run.sh <out dir> <iterations> [games per thread=16] [every=25] [deals=20000]
# Writes <out>/log.txt (appo iteration lines), <out>/avs.txt ("iter N" + the two avs lines), appo-<N>.json
# snapshots. Resumable (appo-meta.txt). Env passes through to fvi appo (LR, BETA, POOLP, TABLES, INIT, TRAIN_THREADS, ...).
set -e
here="$(cd "$(dirname "$0")" && pwd)"
OUT="$1"; T="$2"; G="${3:-16}"; EVERY="${4:-25}"; DEALS="${5:-20000}"
[ -n "$NOBUILD" ] || g++ -O3 -march=native -ffast-math -std=c++17 -pthread "$here/fvi.cpp" -o "$here/fvi" 2>/dev/null
[ -f "$here/../nash/live.json" ] || python3 "$here/../nash/dequant.py" "$here/../../../public/no_thanks/bot-net.json" "$here/../nash/live.json"
mkdir -p "$OUT"; cd "$OUT"; export LIVE="$here/../nash/live.json"
done_t=0; [ -f appo-meta.txt ] && done_t=$(cut -d' ' -f1 appo-meta.txt)
while [ "$done_t" -lt "$T" ]; do
  next=$(( done_t + EVERY )); [ "$next" -gt "$T" ] && next=$T
  "$here/fvi" appo "$next" "$G" >> log.txt
  done_t=$next; cp appo.json "appo-$done_t.json"; cp appo-meta.txt "appo-$done_t-meta.txt"
  if [ -f appo-adv.json ]; then cp appo-adv.json "appo-$done_t-adv.json"; fi
  echo "iter $done_t" >> avs.txt
  "$here/fvi" avs "appo-$done_t.json" "$DEALS" >> avs.txt
done
