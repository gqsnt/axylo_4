import { copyFile, cp, lstat, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { agentArgs, agentVersion, observeAgent, reportedError, runAgent } from './agent.mjs';
import { auditTranscript } from './audit.mjs';
import { isMain, tasks, writeJson } from './files.mjs';
import { grade } from './grade.mjs';
import { cells, defaultRecords, effort, inputChanges, inputHashes, models, nextAttempts, observedMatches,
  protocol, readRecords, target, timeoutMs } from './protocol.mjs';
import { prepareWorkspace, removeWorkspace } from './workspace.mjs';

const inputs = new Set(['docs', 'node_modules', 'data.json', 'PROMPT.md', 'package.json', 'grade.json']);

function classify({ agent, exit, audit, observed, result, infrastructure, cliError, changed }) {
  // A timeout is a counted outcome even when killing the process interrupts the transcript.
  if (exit?.timedOut) return ['timeout', 'Agent exceeded the 20-minute limit.'];
  if (infrastructure) return ['infrastructure', infrastructure];
  if (exit?.error) return ['infrastructure', exit.error];
  if (audit.status !== 'no findings') return ['void', audit.problems.join(' ')];
  if (cliError) return ['fail', cliError];
  if (exit.code !== 0 || exit.signal) return ['fail', `Agent exited with ${exit.signal ?? exit.code}.`];
  if (!observedMatches(agent, observed)) return ['void', 'Could not verify the requested model and effort.'];
  if (changed) return ['void', 'Staged inputs changed: ' + changed];
  const browserError = result.criteria.find(item => item.name === 'browser');
  if (browserError) return ['infrastructure', browserError.detail];
  return result.pass ? ['pass', null] : ['fail', result.criteria.filter(item => !item.pass).map(item => item.name).join(', ')];
}

export async function attempt(job, { records, workdir, login = join(homedir(), '.codex', 'auth.json'),
  prepare = prepareWorkspace, version = agentVersion, launch = runAgent, gradeAnswer = grade } = {}) {
  const { agent, task, slot, replaces } = job;
  const start = new Date();
  const record = await mkdtemp(join(records, `${start.toISOString().slice(0, 10)}-${agent}-${task}-${slot}-`));
  const requested = { model: models[agent], effort };
  const cli = { version: null, versionArgs: ['--version'], args: null };
  let prepared, exit, audit, observed, result, infrastructure, cliError, changed;
  try {
    prepared = await prepare(workdir, task, { codexLogin: agent === 'codex' ? login : undefined,
      inputHashes: workspace => inputHashes(workspace, task) });
    const { workspace, codexHome, home } = prepared;
    const options = { ...prepared, ...requested, timeoutMs };
    cli.args = agentArgs(agent, options);
    cli.version = await version(agent, options);
    const { transcript, stderr, exit: agentExit } = await launch(agent, options);
    exit = agentExit;
    await Promise.all([
      copyFile(transcript, join(record, 'transcript.jsonl')),
      copyFile(stderr, join(record, 'stderr.log')),
      cp(workspace, join(record, 'answer'), {
        recursive: true,
        async filter(path) {
          if (inputs.has(relative(workspace, path).split('/')[0])) return false;
          const info = await lstat(path);
          return info.isDirectory() || info.isFile();
        },
      }),
    ]);
    const log = await readFile(transcript, 'utf8');
    [audit, observed] = await Promise.all([auditTranscript(log, workspace, agent, home), observeAgent(agent, log, codexHome)]);
    cliError = reportedError(log);
    if (cliError && !observed.model &&
        /authentication failed|not logged in|api key is (?:missing|invalid)|rate.limit|connection refused|overloaded_error/i.test(cliError)) {
      infrastructure = cliError;
    }
    if (!exit.timedOut && !exit.error && !cliError && exit.code === 0 && !exit.signal &&
        audit.status === 'no findings' && observedMatches(agent, observed)) {
      changed = await inputChanges(workspace, prepared.hashes);
      if (!changed) result = await gradeAnswer(workspace, task);
    }
  } catch (error) {
    infrastructure = String(error);
  }
  const [status, reason] = classify({ agent, exit, audit, observed, result, infrastructure, cliError, changed });
  const end = new Date();
  try {
    if (result) await writeJson(join(record, 'grade.json'), result);
    await writeJson(join(record, 'run.json'), {
      kind: 'agent rehearsal', protocol, agent, task, slot, replaces, status, reason, requested, observed, cli,
      effectiveEffort: observed?.effort ?? (agent === 'claude' && cli.version ? effort : null),
      effortEvidence: agent === 'claude' ? '--effort flag; stream does not expose effective effort' : 'turn_context',
      hashes: prepared?.hashes, browserVersion: result?.browserVersion,
      startedAt: start.toISOString(), endedAt: end.toISOString(), durationMs: end - start,
      timeoutMs, exit, audit,
    });
  } finally {
    if (prepared) await removeWorkspace(prepared.runDirectory);
  }
  return { status, record, reason };
}

export async function runBatch(jobs, workers, run) {
  let next = 0;
  const results = [];
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, async () => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await run(jobs[index]);
    }
  }));
  return results;
}

async function main() {
  const { values } = parseArgs({ options: {
    agent: { type: 'string' }, task: { type: 'string' }, workdir: { type: 'string', default: tmpdir() },
    records: { type: 'string', default: defaultRecords }, attempts: { type: 'string', default: String(target) },
    parallel: { type: 'string', default: '1' },
  } });
  const { agent, task, workdir } = values;
  const attempts = Number(values.attempts);
  const parallel = Number(values.parallel);
  if ((agent && !Object.hasOwn(models, agent)) || (task && !tasks.includes(task)) ||
      [attempts, parallel].some(n => !Number.isSafeInteger(n) || n < 1)) {
    throw new Error('Usage: node rehearsal/run.mjs [--agent codex|claude] [--task <id>] [--attempts <n>] [--parallel <n>] [--workdir <dir>] [--records <dir>]');
  }
  const records = resolve(values.records);
  await mkdir(records, { recursive: true });
  const previous = await readRecords(records);
  const jobs = cells.filter(cell => (!agent || cell.agent === agent) && (!task || cell.task === task))
    .flatMap(cell => nextAttempts(previous, cell, attempts));
  if (!jobs.length) console.log('No open attempt slots in the selected cells.');
  const results = await runBatch(jobs, parallel, async job => {
    const result = await attempt(job, { records, workdir });
    console.log(`${job.agent} / ${job.task} / ${job.slot}: ${result.status}${result.reason ? ' — ' + result.reason : ''}. Record: ${result.record}`);
    return result;
  });
  process.exitCode = results.some(result => result.status === 'infrastructure') ? 2
    : results.some(result => result.status !== 'pass') ? 1 : 0;
}

if (isMain(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 2;
  }
}
