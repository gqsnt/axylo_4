import { readFile, readdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { agentErrors } from './agent.mjs';
import { auditTranscript, auditVersion, transcriptEvents } from './audit.mjs';
import { isMain, readJson, repository, tasks, writeJson } from './files.mjs';
import { grade } from './grade.mjs';
import { inputHashes, models, protocol } from './protocol.mjs';
import { gradeVerdict, verdictBeforeGrade } from './run.mjs';
import { copyAnswer, prepareWorkspace, removeWorkspace } from './workspace.mjs';

function originalDirectories(record, transcript) {
  if (record.auditContext) return record.auditContext;
  // Version 1 kept the Codex working directory in the invocation and Claude's in its init event.
  const args = record.cli?.args ?? [];
  const workspace = record.agent === 'codex' ? (args.includes('-C') ? args[args.indexOf('-C') + 1] : undefined) :
    transcriptEvents(transcript).events.find(event => event.type === 'system' && event.subtype === 'init')?.cwd;
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) throw new Error('Original workspace is missing.');
  const runDirectory = dirname(workspace);
  const home = join(runDirectory, 'home');
  const codexHome = join(home, '.codex');
  const claudeConfigDir = join(home, '.claude');
  const loginLink = record.agent === 'codex' ? join(codexHome, 'auth.json') :
    record.claudeMode === 'fresh-config' ? join(claudeConfigDir, '.credentials.json') : undefined;
  return { workspace, runDirectory, home, codexHome, claudeConfigDir, temporary: join(runDirectory, 'tmp'), loginLink,
    repo: repository, realHome: homedir(), pathEvidence: {} };
}

async function regrade(directory, record, workdir, gradeAnswer) {
  const { task } = record;
  const { workspace, runDirectory, hashes } = await prepareWorkspace(workdir, task, {
    inputHashes: workspace => inputHashes(workspace, task),
  });
  try {
    const keys = new Set([...Object.keys(hashes), ...Object.keys(record.hashes ?? {})]);
    const changed = [...keys].filter(key => hashes[key] !== record.hashes?.[key]);
    if (changed.length) throw new Error('Saved hashes do not match prepared inputs: ' + changed.join(', '));
    await copyAnswer(join(directory, 'answer'), workspace);
    return await gradeAnswer(workspace, task);
  } finally {
    await removeWorkspace(runDirectory);
  }
}

export async function reauditRecords(records, { workdir = tmpdir(), gradeAnswer = grade } = {}) {
  const entries = await readdir(records, { withFileTypes: true });
  const results = [];
  for (const { name } of entries.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const directory = join(records, name);
      const run = join(directory, 'run.json');
      const record = await readJson(run);
      if (record.protocol !== protocol || !Object.hasOwn(models, record.agent) || !tasks.includes(record.task) ||
          !['pass', 'fail', 'timeout', 'void', 'infrastructure'].includes(record.status)) {
        throw new Error('Unsupported rehearsal record.');
      }
      const transcript = await readFile(join(directory, 'transcript.jsonl'), 'utf8');
      const auditContext = originalDirectories(record, transcript);
      const audit = await auditTranscript(transcript, auditContext, record.agent);
      let { status, reason, browserVersion } = record;
      if (status !== 'infrastructure') {
        if (!record.exit) throw new Error('Original CLI exit status is missing.');
        const originalReason = (record.history?.[0] ?? record).reason;
        const changed = originalReason?.match(/^Staged inputs changed: (.+)$/s)?.[1];
        const decision = verdictBeforeGrade({ ...record, ...agentErrors(record.agent, transcript, record.exit), audit, changed });
        if (decision) {
          [status, reason] = decision;
        } else if (status === 'void') {
          const result = await regrade(directory, record, workdir, gradeAnswer);
          [status, reason] = gradeVerdict(result);
          if (status === 'infrastructure') throw new Error(reason);
          browserVersion = result.browserVersion;
          await writeJson(join(directory, 'grade.json'), result);
        }
      }
      const history = [...(record.history ?? []), { status: record.status, reason: record.reason, audit: record.audit,
        auditVersion: record.auditVersion ?? 1, date: record.auditedAt ?? record.endedAt ?? record.startedAt,
        browserVersion: record.browserVersion }];
      await writeJson(run, { ...record, status, reason, browserVersion, audit, auditContext, auditVersion,
        auditedAt: new Date().toISOString(), history });
      results.push({ name, status, reason });
    } catch (error) {
      results.push({ name, error: error.message });
    }
  }
  return results;
}

if (isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { records: { type: 'string' } } });
    if (!values.records) throw new Error('Usage: node rehearsal/reaudit.mjs --records <dir>');
    const results = await reauditRecords(resolve(values.records));
    for (const { name, status, reason, error } of results) {
      if (error) console.error(`${name}: refused — ${error}`);
      else console.log(`${name}: ${status}${reason ? ' — ' + reason : ''}`);
    }
    const refused = results.filter(result => result.error).length;
    console.log(`Re-audited ${results.length - refused} of ${results.length} records.`);
    if (refused) process.exitCode = 2;
  } catch (error) {
    console.error(String(error));
    process.exitCode = 2;
  }
}
