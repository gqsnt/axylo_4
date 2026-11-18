#!/bin/bash
# M1 renderer comparison session: Axylo canvas against Axylo SVG, each against uPlot for reference.
# One build (snapshot of packages/axylo/dist) at the start; every run after it uses --no-build so all runs measure the
# same bytes. Runs are sequential. Run ids are appended to bench/results/m1-runs.tsv (label, run id).
set -u
cd "$(dirname "$0")/../.."
LIST=bench/results/m1-runs.tsv
LOG=bench/results/m1-session.log
: > "$LIST"; : > "$LOG"
node bench/build.mjs | tee -a "$LOG"
run() {
  local label=$1; shift
  local out; out=$(node bench/run.mjs --no-build "$@" 2>&1)
  echo "$out" >> "$LOG"
  local id; id=$(echo "$out" | awk '/^run /{print $2; exit}')
  printf '%s\t%s\n' "$label" "${id:-FAILED}" >> "$LIST"
  echo "$(date +%T) $label -> ${id:-FAILED}"
}
idof() { awk -F'\t' -v l="$1" '$1==l{print $2}' "$LIST"; }

# Noise bands first, so the comparisons can be classified against them.
run aa-canvas-first-100k --aa axylo-canvas --workload first --size 1x100000 --blocks 8
run aa-svg-first-100k    --aa axylo-svg    --workload first --size 1x100000 --blocks 8
run aa-canvas-page       --aa axylo-canvas --workload page --blocks 8
run aa-svg-page          --aa axylo-svg    --workload page --blocks 8
N100K="$(idof aa-canvas-first-100k),$(idof aa-svg-first-100k)"
NPAGE="$(idof aa-canvas-page),$(idof aa-svg-page)"

for size in 3x120 1x10000 1x100000; do
  noise=(); [ "$size" = 1x100000 ] && noise=(--noise "$N100K")
  run "first-$size-canvas-vs-svg"   --baseline axylo-canvas --candidate axylo-svg    --workload first --size $size --blocks 8 "${noise[@]}"
  run "first-$size-uplot-vs-canvas" --baseline uplot        --candidate axylo-canvas --workload first --size $size --blocks 8 "${noise[@]}"
  run "first-$size-uplot-vs-svg"    --baseline uplot        --candidate axylo-svg    --workload first --size $size --blocks 8 "${noise[@]}"
done
run first-1x100000gaps-canvas-vs-svg   --baseline axylo-canvas --candidate axylo-svg    --workload first --size 1x100000 --gaps --blocks 8
run first-1x100000gaps-uplot-vs-canvas --baseline uplot        --candidate axylo-canvas --workload first --size 1x100000 --gaps --blocks 8
run first-1x100000gaps-uplot-vs-svg    --baseline uplot        --candidate axylo-svg    --workload first --size 1x100000 --gaps --blocks 8
run first-1x1000000-canvas-vs-svg   --baseline axylo-canvas --candidate axylo-svg    --workload first --size 1x1000000 --blocks 4
run first-1x1000000-uplot-vs-canvas --baseline uplot        --candidate axylo-canvas --workload first --size 1x1000000 --blocks 4
run first-1x1000000-uplot-vs-svg    --baseline uplot        --candidate axylo-svg    --workload first --size 1x1000000 --blocks 4

run page-canvas-vs-svg   --baseline axylo-canvas --candidate axylo-svg    --workload page --blocks 8 --noise "$NPAGE"
run page-uplot-vs-canvas --baseline uplot        --candidate axylo-canvas --workload page --blocks 8 --noise "$NPAGE"
run page-uplot-vs-svg    --baseline uplot        --candidate axylo-svg    --workload page --blocks 8 --noise "$NPAGE"

run stream-canvas-vs-svg   --baseline axylo-canvas --candidate axylo-svg    --workload stream --blocks 8
run stream-uplot-vs-canvas --baseline uplot        --candidate axylo-canvas --workload stream --blocks 6
run stream-uplot-vs-svg    --baseline uplot        --candidate axylo-svg    --workload stream --blocks 6

run theme-canvas-vs-svg   --baseline axylo-canvas --candidate axylo-svg    --workload theme --blocks 8
run theme-uplot-vs-canvas --baseline uplot        --candidate axylo-canvas --workload theme --blocks 2

run resize-1x100000-canvas-vs-svg   --baseline axylo-canvas --candidate axylo-svg    --workload resize --size 1x100000 --blocks 8
run resize-1x100000-uplot-vs-canvas --baseline uplot        --candidate axylo-canvas --workload resize --size 1x100000 --blocks 6
run resize-1x100000-uplot-vs-svg    --baseline uplot        --candidate axylo-svg    --workload resize --size 1x100000 --blocks 6
run resize-page-canvas-vs-svg   --baseline axylo-canvas --candidate axylo-svg    --workload resize --size 3x120 --charts 24 --blocks 8
run resize-page-uplot-vs-canvas --baseline uplot        --candidate axylo-canvas --workload resize --size 3x120 --charts 24 --blocks 6
run resize-page-uplot-vs-svg    --baseline uplot        --candidate axylo-svg    --workload resize --size 3x120 --charts 24 --blocks 6

# Memory at device pixel ratio 2 (ratio 1 comes from the first/page runs above).
run dpr2-first-1x100000-canvas-vs-svg   --baseline axylo-canvas --candidate axylo-svg    --workload first --size 1x100000 --dpr 2 --blocks 6
run dpr2-first-1x100000-uplot-vs-canvas --baseline uplot        --candidate axylo-canvas --workload first --size 1x100000 --dpr 2 --blocks 6
run dpr2-first-1x100000-uplot-vs-svg    --baseline uplot        --candidate axylo-svg    --workload first --size 1x100000 --dpr 2 --blocks 6
run dpr2-page-canvas-vs-svg   --baseline axylo-canvas --candidate axylo-svg    --workload page --dpr 2 --blocks 6
run dpr2-page-uplot-vs-canvas --baseline uplot        --candidate axylo-canvas --workload page --dpr 2 --blocks 6
run dpr2-page-uplot-vs-svg    --baseline uplot        --candidate axylo-svg    --workload page --dpr 2 --blocks 6

# CPU profiles (not timings): production and development builds of each renderer, at 3x120 and 1x100000.
for size in 3x120 1x100000; do
  for r in canvas svg; do
    for b in prod dev; do
      node bench/profile.mjs --no-build --adapter "axylo:renderer=$r,build=$b" --size $size >> "$LOG" 2>&1 && echo "$(date +%T) profile $size $r $b"
    done
  done
done
echo SESSION-DONE | tee -a "$LOG"
