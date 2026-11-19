import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const repo = process.cwd(), dir = resolve(process.argv[2]);
const runtime = JSON.parse(await readFile(join(dir, 'runtime-private.json'), 'utf8'));
const services = JSON.parse(await readFile(join(dir, 'services.json'), 'utf8'));
const fixture = JSON.parse(await readFile(join(dir, 'fixture-private.json'), 'utf8'));
assert.equal(fixture.kind, 'disposable');
assert.equal(runtime.env.POSTGRES_HOST, '127.0.0.1');
assert.match(runtime.env.POSTGRES_DB, /^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(services.label, 'z8-performance-fixture-1450');
assert.equal(services.containers.length, 3);
for (const container of services.containers) {
  assert.match(container, /^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);
  assert.equal(execFileSync('docker', ['inspect', '--format', '{{ index .Config.Labels "z8.agent-owned" }}', container], { encoding: 'utf8', windowsHide: true }).trim(), services.label);
}
const env = { ...process.env, ...runtime.env, pnpm_config_verify_deps_before_run: 'false',
  APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL: 'approval-workflow-repository-test',
  APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL: `postgresql://${encodeURIComponent(runtime.env.POSTGRES_USER)}:${encodeURIComponent(runtime.env.POSTGRES_PASSWORD)}@127.0.0.1:${runtime.env.POSTGRES_PORT}/${runtime.env.POSTGRES_DB}`,
};
const extra = process.argv[3] === 'access';
const name = extra ? 'postgres-access' : 'postgres';
const paths = extra ? ['src/lib/personnel-file/personnel-file.integration.test.ts', 'src/lib/personnel-file/officer-grants.integration.test.ts'] :
  ['src/lib/personnel-file/retention.integration.test.ts', 'src/lib/personnel-file/audit-minimisation.integration.test.ts', 'src/lib/personnel-file/document-request-retention.integration.test.ts'];
const args = ['--config.verify-deps-before-run=false', '--filter', 'webapp', 'exec', 'vitest', 'run', '--project', 'integration',
  ...paths, '--reporter=json', `--outputFile=../../docs/design/rollout-1692/1731/${name}.json`];
const log = createWriteStream(`docs/design/rollout-1692/1731/${name}.log`);
await once(log, 'open');
const code = await new Promise((done, reject) => {
  const child = spawn(process.env.npm_execpath, args, { cwd: repo, env, windowsHide: true, stdio: ['ignore', log, log] });
  child.once('error', reject); child.once('exit', done);
});
log.end();
await writeFile(`docs/design/rollout-1692/1731/${name}-command.json`, JSON.stringify({ command: ['pnpm', ...args], code, guarded: true, ownedLoopback: true }, null, 2) + '\n');
console.log(`Owned PostgreSQL suites exit ${code}; no connection credentials published.`);
process.exitCode = code;
