import { copyFile, lstat, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { observeAgent, runAgent } from './agent.mjs';
import { auditTranscript } from './audit.mjs';
import { isMain, rehearsal, writeJson } from './files.mjs';
import { grade } from './grade.mjs';
import { prepareWorkspace } from './workspace.mjs';

async function reserveRecord(date, agent, task) {
  const records = join(rehearsal, 'records');
  await mkdir(records, { recursive: true });
  for (let n = 1; ; n++) {
    const record = join(records, `${date}-${agent}-${task}-${n}`);
    try {
      await mkdir(record);
      return record;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      agent: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' }, task: { type: 'string' },
      workdir: { type: 'string', default: tmpdir() }, 'timeout-ms': { type: 'string', default: '1200000' },
    },
  });
  const { agent, model, effort, task, workdir } = values;
  const timeoutMs = Number(values['timeout-ms']);
  if (!['codex', 'claude'].includes(agent) || !model || !task ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
    throw new Error('Usage: node rehearsal/run.mjs --agent codex|claude --model <id> [--effort <e>] --task <id> [--workdir <dir>] [--timeout-ms <ms>]');
  }

  const { workspace, runDirectory } = await prepareWorkspace(workdir, task);
  console.log('Workspace: ' + workspace);
  const start = new Date();
  const { transcript, stderr, exit } = await runAgent(agent, { model, effort, workspace, runDirectory, timeoutMs });
  const end = new Date();
  const log = await readFile(transcript, 'utf8');
  const [audit, observed] = await Promise.all([auditTranscript(log, workspace), observeAgent(agent, log)]);
  const record = await reserveRecord(start.toISOString().slice(0, 10), agent, task);
  await copyFile(transcript, join(record, 'transcript.jsonl'));
  await copyFile(stderr, join(record, 'stderr.log'));

  const answer = join(workspace, 'chart.js');
  const answerStat = await lstat(answer).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (answerStat?.isFile()) await copyFile(answer, join(record, 'chart.js'));
  let result;
  try {
    result = await grade(workspace, task);
  } catch (error) {
    result = { pass: false, criteria: [{ name: 'grader', pass: false, detail: String(error) }], diagnostics: [], timezones: [] };
    await writeJson(join(workspace, 'grade.json'), result);
  }
  await copyFile(join(workspace, 'grade.json'), join(record, 'grade.json'));
  await writeJson(join(record, 'run.json'), {
    kind: 'agent rehearsal', agent, task, requested: { model, effort: effort ?? null }, observed,
    startedAt: start.toISOString(), endedAt: end.toISOString(), durationMs: end - start,
    timeoutMs, exit, ...audit,
  });
  const agentFailed = exit.code !== 0 || exit.timedOut || exit.error !== null;
  const status = audit.void ? 'void' : agentFailed || !result.pass ? 'fail' : 'pass';
  console.log(`Agent rehearsal: ${status}. Record: ${record}`);
  process.exitCode = exit.error || result.criteria.some(item => ['browser', 'grader'].includes(item.name)) ? 2
    : status === 'pass' ? 0 : 1;
}

if (isMain(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 2;
  }
}
