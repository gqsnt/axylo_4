# Histograms

A histogram shows how one measurement is distributed. Each bar covers an interval on the numeric x axis. Its height starts at zero. In this example, a request taking exactly 50 ms belongs to the 50–100 ms bin, and a request taking exactly 250 ms belongs to the final bin.

[example: histogram-basic](../examples/histogram-basic.ts)

## Choose the bins

Omit `bins` for automatic widths based on the interquartile range (Freedman–Diaconis), with Sturges’ rule as a fallback. Give a whole number from 1 to 100 for equal-width bins, or an array of edges to keep intervals comparable across charts. Samples outside explicit edges raise AX106 and count toward the figure’s omission note. Missing samples are skipped.

## Read the heights

The default height is the sample count. With `normalize: 'probability'`, heights are shares of the binned samples and sum to one. With `'density'`, each height is the share divided by the bin width, so the bar areas sum to one. Density is useful for comparing unequal intervals.

Point anywhere in a bin or use the arrow keys to read its interval and value. The table includes empty bins. Zoom clips the same bars and preserves their heights. On a stream, `append(rows, { keep })` retains the latest source rows and recomputes the distribution.
