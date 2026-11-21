#!/usr/bin/env bash
# The benchmark plan of docs/04-plan-performance.md 5.1, both families, on artifact $A, started by the
# coordinator on 2026-11-19. Load is logged for context under the owner's decision of 2026-11-21.
set -u
cd /home/canarit/projects/axylo
A=bench/artifacts/20261119T091624Z-b643862f-b78698
LOG=bench/results/run-2026-11-19.log
step() { echo "=== $* $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $LOG; node bench/decision.mjs "$@" --artifact $A >> $LOG 2>&1; echo "exit $? $*" >> $LOG; }
for fam in renderer gpu; do
  F=(); [ $fam = gpu ] && F=(--family gpu)
  step controls "${F[@]}"; step controls "${F[@]}"; step controls "${F[@]}"
  step pilot "${F[@]}"; step endpoints "${F[@]}"
  echo "=== decide $fam" >> $LOG; node bench/decision.mjs decide "${F[@]}" --artifact $A >> $LOG 2>&1; echo "exit $? decide $fam" >> $LOG
done
echo "=== done $(date -u +%FT%TZ)" >> $LOG
