// pnpm node .../fixture-command.mjs <owned-fixture> <seed|integration>
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const repo=process.cwd(), directory=resolve(process.argv[2]), command=process.argv[3];
const runtime=JSON.parse(await readFile(join(directory,'runtime-private.json'),'utf8'));
const services=JSON.parse(await readFile(join(directory,'services.json'),'utf8'));
if(services.label!=='z8-performance-fixture-1450'||runtime.env.POSTGRES_HOST!=='127.0.0.1'||!/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(runtime.env.POSTGRES_DB))throw Error('Owned disposable loopback fixture required');
for(const container of services.containers)if(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8',windowsHide:true}).trim()!==services.label)throw Error('Service ownership mismatch');
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key))),...runtime.env,NODE_ENV:'test',BILLING_ENABLED:'false',TELEMETRY_ENABLED:'false',ENABLE_CRON_JOBS:'false',pnpm_config_verify_deps_before_run:'false'};
const args=['seed','clock-worker','replacement'].includes(command)?['exec','tsx','--import','./src/worker-preload.mjs',join(repo,`docs/design/rollout-1692/1824/${command}.mts`),directory]:command==='integration'?['exec','vitest','run','--project','integration',...process.argv.slice(4)]:null;
if(!args)throw Error('seed or integration required');
const native=process.env.npm_execpath.endsWith('.exe');
const child=spawn(native?process.env.npm_execpath:process.execPath,native?args:[process.env.npm_execpath,...args],{cwd:join(repo,'apps/webapp'),env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);
