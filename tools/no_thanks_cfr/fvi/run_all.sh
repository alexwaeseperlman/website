#!/bin/bash
# The whole backward induction with anet, stages 0..23, 2 players. Run from tools/no_thanks_cfr/fvi:
#   ./run_all.sh <out dir> [chains per stage] [epochs]      (env TRAIN_THREADS caps the training threads, default 16)
# Writes a<k>.json, aloss<k>.csv and log.txt into the out dir; checks stages 0-3 against the exact solver and plays the
# result against the live bot.
set -e
OUT=${1:?out dir}; CHAINS=${2:-150000}; EPOCHS=${3:-8}
here=$(cd "$(dirname "$0")" && pwd)
g++ -O3 -march=native -ffast-math -std=c++17 -pthread "$here/fvi.cpp" -o "$here/fvi"
[ -f "$here/../nash/live.json" ] || python3 "$here/../nash/dequant.py" "$here/../../../public/no_thanks/bot-net.json" "$here/../nash/live.json"
mkdir -p "$OUT"; cd "$OUT"; export LIVE="$here/../nash/live.json"
for k in $(seq 0 23); do
  if [ -f a$k.json ]; then echo "stage $k already done" | tee -a log.txt; continue; fi
  # stage 0 starts from scratch; stage 1 (first averaging over the next card) fits slowly from stage 0's weights
  E=$EPOCHS; [ $k -le 1 ] && E=$((EPOCHS * 5)); [ $k = 2 ] && E=$((EPOCHS * 2))
  "$here/fvi" atrain $k $CHAINS $E | tee -a log.txt
  if [ $k -le 3 ]; then "$here/fvi" acheck $k 1000 | tee -a log.txt; fi
  if [ $((k % 4)) = 3 ] || [ $k = 23 ]; then "$here/fvi" aplay ${PLAY:-20000} | tee -a log.txt; fi
done
