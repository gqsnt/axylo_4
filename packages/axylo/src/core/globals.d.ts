/** Replaced at build time: true in the development flavour, false in production. Tests run with true. */
declare const __DEV__: boolean;
/**
 * Replaced at build time: true only in a build that carries the benchmark instrumentation (core/instrument.ts),
 * such as the benchmark harness's own; false in every shipped file. Read through `typeof` where used, so a build
 * that defines only __DEV__ still runs.
 */
declare const __BENCH__: boolean;
