#!/usr/bin/env bash
# The benchmark plan of docs/04-plan-performance.md 5.1, both families, on artifact $A, started by the
# coordinator on 2026-11-19. Before each session it waits until the machine has been idle (one-minute load
# under 1.0) for ten consecutive minutes, because the procedure discards any block taken while busy.
set -u
cd /home/canarit/projects/axylo
A=bench/artifacts/20261119T091624Z-b643862f-b78698
LOG=bench/results/run-2026-11-19.log
idle() {
  local quiet=0
  while [ $quiet -lt 10 ]; do
    l=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$l" 'BEGIN{exit !(l<1.0)}'; then quiet=$((quiet+1)); else quiet=0; fi
    sleep 60
  done
}
step() { idle; echo "=== $* $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $LOG; node bench/decision.mjs "$@" --artifact $A >> $LOG 2>&1; echo "exit $? $*" >> $LOG; }
for fam in renderer gpu; do
  F=(); [ $fam = gpu ] && F=(--family gpu)
  step controls "${F[@]}"; step controls "${F[@]}"; step controls "${F[@]}"
  step pilot "${F[@]}"; step endpoints "${F[@]}"
  echo "=== decide $fam" >> $LOG; node bench/decision.mjs decide "${F[@]}" --artifact $A >> $LOG 2>&1; echo "exit $? decide $fam" >> $LOG
done
echo "=== done $(date -u +%FT%TZ)" >> $LOG
