#!/bin/bash
# feature ablations: each run trains 40 rounds from scratch in abl/<name>
cd "$(dirname "$0")"
cp ../policy.json . 2>/dev/null
run(){ name=$1; drop=$2; seed=${3:-0}
  [ -f deep-pnet-$name-adv.json ] && grep -q '"t":40' deep-pnet-$name-ckpt/meta.json 2>/dev/null && return
  TAG=$name DROP=$drop SEED=$seed PSTEPS=1 ../deep 40 2500 4 pnet > $name.log 2>&1
  rm -f deep-pnet-$name-ckpt/adv.bin deep-pnet-$name-ckpt/pol.bin   # 3GB each; keep meta only
}
run base ""
run base2 "" 1
run nocost cost
run nopts pts
run noncards ncards
run nosin chipsin,potsin
run nounseen unseen,offboard
run noseat seat
run noscore cost,pts,ncards
run minimal cost,pts,ncards,chipsin,potsin,unseen,offboard
echo all done
