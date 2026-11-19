# Fix: the acceptance checker's title scanner nests a top-level describe under the previous one

You are working in /home/canarit/projects/axylo (Axylo, a TypeScript browser charting library). Read `AGENTS.md` and `acceptance/README.md` first. You may edit only `acceptance/titles.mjs`, `acceptance/check.mjs` and `acceptance/test/**` (fixtures included). Do not edit anything else: other agents work in this checkout. You cannot commit (`.git` is read-only for you); the coordinator commits after verifying. Do not install anything; the network is off.

## The defect

`readTitles(source, file)` in `acceptance/titles.mjs` lists each test's title and its describe ancestors, statically. For `packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts` it reports the top-level suite "I2 legend toggles" with ancestors `["I1 tooltip under the pointer", "I2 legend toggles"]`: it nests that describe, and every later one in the file, under the previous top-level describe. Reproduce:

```sh
node --input-type=module -e 'import { readTitles } from "./acceptance/titles.mjs"; import { readFileSync } from "node:fs"; const f = "packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts"; const o = readTitles(readFileSync(f, "utf8"), f); console.log(o.tests.filter(t => t.title.startsWith("I2 line")).map(t => t.ancestors))'
```

The recorded run (`acceptance/results/browser.json`, Vitest JSON) has the true ancestors (`ancestorTitles`): compare. Because the checker matches a citation to a result through the scanned ancestors, 18 matrix cells (rows I1, I2, I5, I6) read "not run" in `node acceptance/check.mjs --release --results acceptance/results/unit.json acceptance/results/browser.json acceptance/results/browser-firefox.json acceptance/results/browser-webkit.json acceptance/results/dist.json acceptance/results/dist-browser.json` although `browser.json` passes every cited test. That file grew in a recent pass (new tests, template literals, nested callbacks, regular expressions); the likeliest cause is the scanner's tracking of braces, template literals (`${…}` inside backquotes), comments or regular expression literals, but find it, do not assume it.

## What to do

1. Write a failing test first in `acceptance/test/` with a small fixture reproducing the construct that breaks the scanner (and a second check that runs the scanner over the real `i1-pointer.browser.test.ts` and compares every test's ancestors with `acceptance/results/browser.json`'s `ancestorTitles` for that file, when that results file exists; skip that comparison with a clear message when it does not).
2. Fix the scanner. Then run the scanner over every test file the matrix cites (`acceptance/matrix.json`) and compare with the recorded results in `acceptance/results/*.json` wherever a file has results: report any other file whose ancestors disagree, and fix those too if it is the same defect.
3. A cell that reads "not run" while every report for it passed must carry a reason in `check()`'s output (today `reasons` is empty in that case): add one that names the citation that found no matching test (file and title), so the next such mismatch explains itself. Test it.
4. Run `node --test acceptance/test/*.test.mjs` and the release check above, and report its last lines (the counts). The matrix is not yours: do not edit `acceptance/matrix.json` or `acceptance/report.md`.

## Report (your final message)

The cause (file and line), the change, the tests you added, the other files whose ancestors disagreed (if any), the release check's counts before and after, and the last lines of the checker's tests. Keep what you ran and saw apart from what you expect.
