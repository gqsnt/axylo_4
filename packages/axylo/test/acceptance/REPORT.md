# Node acceptance mutation report

Each scratch Vitest entry mocked the real module with a mutated copy, then imported the real acceptance tests. The control imported the same tests without a mutation. All scratch files were removed. Browser configurations were outside this run.

## Control

309 passed and 6 failed. The following failures were present without a mutation.

- F10 area: a missing area component has zero height and the reader is told which stack is incomplete
- F10 bar: a missing bar component has zero height and the reader is told which stack is incomplete
- F7 line: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain
- F7 area: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain
- F7 bar: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain
- F7 scatter: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain

## Finding 1

Forced the dense selector in `simplify/index.ts` to emit all vertices. 8 additional assertions failed.

- F5 line: for every generated dense line dataset the drawing keeps each run’s column extrema and its breaks
- F5 area: for every generated dense area dataset the drawing keeps each run’s column extrema and its breaks
- F5 compact: for every generated dense line dataset the drawing keeps each run’s column extrema and its breaks
- F5 compact: for every generated dense area dataset the drawing keeps each run’s column extrema and its breaks
- F5 line: one outlier in one million stays drawn at DPR 1 and 2 and a dropped sample stays reachable by keyboard and table
- T-dense-line line: two peaks and their gap survive at two zoom levels and two device-pixel ratios
- T-dense-area area: two peaks and their gap survive at two zoom levels and two device-pixel ratios
- F5 line: two peaks separated by a null in one device column remain in separate drawn runs

## Finding 2

Replaced the kept minimum with the first source index in each device column. 8 additional assertions failed.

- F5 line: for every generated dense line dataset the drawing keeps each run’s column extrema and its breaks
- F5 area: for every generated dense area dataset the drawing keeps each run’s column extrema and its breaks
- F5 compact: for every generated dense line dataset the drawing keeps each run’s column extrema and its breaks
- F5 compact: for every generated dense area dataset the drawing keeps each run’s column extrema and its breaks
- F5 line: one outlier in one million stays drawn at DPR 1 and 2 and a dropped sample stays reachable by keyboard and table
- T-dense-line line: two peaks and their gap survive at two zoom levels and two device-pixel ratios
- T-dense-area area: two peaks and their gap survive at two zoom levels and two device-pixel ratios
- F5 line: two peaks separated by a null in one device column remain in separate drawn runs

## Finding 3

Replaced the viewer-zone fallback with UTC in `data/x.ts`, keeping explicit zones. 21 additional assertions failed.

- F4 line: ISO with offset read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 line: Date objects read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 line: declared epoch milliseconds read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 area: ISO with offset read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 area: Date objects read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 area: declared epoch milliseconds read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 bar: ISO with offset read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 bar: Date objects read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 bar: declared epoch milliseconds read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 scatter: ISO with offset read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 scatter: Date objects read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 scatter: declared epoch milliseconds read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 compact: ISO with offset read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 compact: Date objects read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 compact: declared epoch milliseconds read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)
- F4 line: generated instants around DST and the year boundary preserve elapsed time and local readouts
- F3 line: AX152 keeps both observations and reads the axis as specified
- F3 area: AX152 keeps both observations and reads the axis as specified
- F3 bar: AX152 keeps both observations and reads the axis as specified
- F3 scatter: AX152 keeps both observations and reads the axis as specified
- F3 compact: AX152 keeps both observations and reads the axis as specified

## Finding 4

Restricted `PointSeries.missingX` to null and absent y in `data/normalize.ts`. 6 additional assertions failed.

- F2 scatter: appending unplottable values retains their table rows and missing zero only imputes missing values
- DX2 scatter: supported row and column forms draw the same fixture and preserve caller row indexes in diagnostics
- F3 scatter: AX103 omits the bad value, preserves its neighbours and discloses one omission
- F3 scatter: AX106 omits the bad value, preserves its neighbours and discloses one omission
- F3 scatter: AX106 retains an all-string non-decimal column only in the table
- F12 scatter: three bad values leave a three-value note and summary while the chart preserves the good observations

## Finding 5

Chose the stacking side from the first y in each series in `view/stack.ts`. 4 additional assertions failed alongside 2 control failures.

- F10 area: for any generated mixed-sign area stacks each drawn component uses its own side of zero and the axis covers both sums
- F10 bar: for any generated mixed-sign bar stacks each drawn component uses its own side of zero and the axis covers both sums
- F10 compact: for any generated mixed-sign area stacks each drawn component uses its own side of zero and the axis covers both sums
- F10 compact: for any generated mixed-sign bar stacks each drawn component uses its own side of zero and the axis covers both sums

## Finding 6

Set every declared percent or ratio maximum below half scale to half scale in `scale/domain.ts`. 10 additional assertions failed alongside 4 control failures.

- F7 line: declared percent reaches full scale at half scale while a small maximum uses the first tick
- F7 line: declared ratio reaches full scale at half scale while a small maximum uses the first tick
- F7 area: declared percent reaches full scale at half scale while a small maximum uses the first tick
- F7 area: declared ratio reaches full scale at half scale while a small maximum uses the first tick
- F7 bar: declared percent reaches full scale at half scale while a small maximum uses the first tick
- F7 bar: declared ratio reaches full scale at half scale while a small maximum uses the first tick
- F7 scatter: declared percent reaches full scale at half scale while a small maximum uses the first tick
- F7 scatter: declared ratio reaches full scale at half scale while a small maximum uses the first tick
- F7 compact: declared percent reaches full scale at half scale while a small maximum uses the first tick
- F7 compact: declared ratio reaches full scale at half scale while a small maximum uses the first tick

## Finding 12

Removed the forced marker for isolated slots in `scene/lines.ts`. 2 additional assertions failed.

- F2 line: an isolated value between two gaps is drawn at its coordinates below 12 px spacing
- F2 area: an isolated value between two gaps is drawn at its coordinates below 12 px spacing
