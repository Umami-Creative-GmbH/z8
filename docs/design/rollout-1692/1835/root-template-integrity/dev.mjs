import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const [command, repoInput, fixtureInput, ...actors] = process.argv.slice(2);
const repo = resolve(repoInput), directory = resolve(fixtureInput), app = join(repo, 'apps/webapp');
const json = async file => JSON.parse(await readFile(join(directory, file), 'utf8'));
const runtime = await json('runtime-private.json'), fixture = await json('fixture-private.json'), services = await json('services.json');
const loopback = value => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
if (fixture.kind !== 'disposable' || !loopback(runtime.origin) || services.label !== 'z8-performance-fixture-1450' || !/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(runtime.env.POSTGRES_DB) || runtime.env.POSTGRES_HOST !== '127.0.0.1' || !loopback(runtime.env.S3_PUBLIC_ENDPOINT)) throw Error('Only a generated disposable loopback fixture is accepted.');
if (command === 'dev') {
  for (const c of services.containers) {
    if (!/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/.test(c)) throw Error('Invalid owned service name.');
    const label = execFileSync('docker', ['inspect', '--format', '{{ index .Config.Labels "z8.agent-owned" }}', c], {encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe']}).trim();
    if (label !== services.label) throw Error('Owned service label mismatch.');
  }
  for (const location of [repo, app]) {
    if ((await readdir(location)).some(name => /^\.env(?:$|\.(local|development|development\.local)$)/.test(name))) throw Error('Use an env-file-free worktree; Next would auto-load local env files. Do not read or remove another worker\'s files.');
  }
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|SWC_NATIVE_BINDING_CACHE)$/i;
  const env = {...Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key))), ...runtime.env,
    NODE_ENV:'development', CI:'false', TZ:'UTC', SKIP_ENV_VALIDATION:'0', BILLING_ENABLED:'false', TELEMETRY_ENABLED:'false', NEXT_TELEMETRY_DISABLED:'1', ENABLE_CRON_JOBS:'false', REDIS_COMMAND_TIMEOUT_MS:'2000',
    S3_PRIVATE_BUCKET:runtime.env.S3_PUBLIC_BUCKET, S3_PRIVATE_ACCESS_KEY_ID:runtime.env.S3_PUBLIC_ACCESS_KEY_ID, S3_PRIVATE_SECRET_ACCESS_KEY:runtime.env.S3_PUBLIC_SECRET_ACCESS_KEY, S3_PRIVATE_ENDPOINT:runtime.env.S3_PUBLIC_ENDPOINT, S3_PRIVATE_REGION:runtime.env.S3_PUBLIC_REGION, S3_PRIVATE_FORCE_PATH_STYLE:'true'};
  const log = createWriteStream(join(directory,'dev-private.log'), {flags:'a',mode:0o600});
  await new Promise((done, reject) => { log.once('open', done); log.once('error', reject); });
  const child = spawn(process.execPath, [join(app,'node_modules/next/dist/bin/next'), 'dev','--turbopack','--hostname','localhost','--port',String(runtime.port)], {cwd:app,env,windowsHide:true,stdio:['ignore',log,log]});
  const manifest=JSON.stringify({pid:child.pid,repo,origin:runtime.origin,launchedAt:new Date().toISOString()},null,2);
  await writeFile(join(directory,'dev-process-private.json'),manifest,{mode:0o600});
  await writeFile(join(directory,'dev-process-'+child.pid+'-private.json'),manifest,{mode:0o600});
  console.log(`Owned Next dev starting at ${runtime.origin}; inspect dev-private.log. Keep this process running and stop it before fixture cleanup.`);
  const stop=()=>child.kill(); process.once('SIGINT',stop); process.once('SIGTERM',stop);
  child.once('error',()=>{console.error('Owned Next dev could not start; inspect private log.');process.exitCode=1;log.end();});
  child.once('exit',code=>{process.exitCode=code??0;log.end();});
} else throw Error('dev only');
