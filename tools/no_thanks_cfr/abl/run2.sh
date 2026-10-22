#!/bin/bash
# second seeds for the surprising ablations (see run.sh)
cd "$(dirname "$0")"
run(){ name=$1; drop=$2; seed=${3:-0}
  grep -q '"t":40' deep-pnet-$name-ckpt/meta.json 2>/dev/null && return
  TAG=$name DROP=$drop SEED=$seed PSTEPS=1 ../deep 40 2500 4 pnet > $name.log 2>&1
  rm -f deep-pnet-$name-ckpt/adv.bin deep-pnet-$name-ckpt/pol.bin
}
run base3 "" 2
run nocost2 cost 1
run nosin2 chipsin,potsin 1
run nounseen2 unseen,offboard 1
run minimal2 cost,pts,ncards,chipsin,potsin,unseen,offboard 1
echo all done
