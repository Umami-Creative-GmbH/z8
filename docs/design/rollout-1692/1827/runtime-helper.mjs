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
for(const c of services.containers){if(!/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/.test(c))throw Error('Invalid owned container identity');if(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim()!==services.label)throw Error('Container label mismatch');}
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
  await new Promise((resolve, reject) => { log.once('open', resolve); log.once('error', reject); });
  const child = spawn(process.execPath, [join(app,'node_modules/next/dist/bin/next'), 'dev','--turbopack','--hostname','localhost','--port',String(runtime.port)], {cwd:app,env,windowsHide:true,stdio:['ignore',log,log]});
  await writeFile(join(directory,'dev-process-private.json'), JSON.stringify({pid:child.pid,repo,origin:runtime.origin},null,2),{mode:0o600});
  console.log(`Owned Next dev starting at ${runtime.origin}; inspect dev-private.log. Keep this process running and stop it before fixture cleanup.`);
  const stop=()=>child.kill(); process.once('SIGINT',stop); process.once('SIGTERM',stop);
  child.once('error',()=>{console.error('Owned Next dev could not start; inspect private log.');process.exitCode=1;log.end();});
  child.once('exit',code=>{process.exitCode=code??0;log.end();});
} else if (command === 'auth') {
  const result = {};
  for (const name of actors.length ? actors : Object.keys(fixture.actors)) {
    const actor=fixture.actors[name]; if (!actor) throw Error('Unknown synthetic actor label.');
    const cookies=new Map();
    const update=headers=>{for(const line of headers.getSetCookie()){const [pair,...attrs]=line.split(';');const at=pair.indexOf('=');const values=new Map(attrs.map(v=>{const [k,...rest]=v.trim().split('=');return [k.toLowerCase(),rest.join('=')]}));const name=pair.slice(0,at);if(values.get('max-age')==='0'){cookies.delete(name);continue;}const same=values.get('samesite');cookies.set(name,{name,value:pair.slice(at+1),domain:values.get('domain')||new URL(runtime.origin).hostname,path:values.get('path')||'/',httpOnly:values.has('httponly'),secure:values.has('secure'),...(same?{sameSite:same[0].toUpperCase()+same.slice(1).toLowerCase()}:{})});}};
    const post=async(path,body)=>{for(let attempt=0;attempt<5;attempt++){const response=await fetch(new URL(path,runtime.origin),{method:'POST',headers:{'Content-Type':'application/json',Origin:runtime.origin,'x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX',Cookie:[...cookies.values()].map(c=>`${c.name}=${c.value}`).join('; ')},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(response.status!==429)return response;const retry=response.headers.get('retry-after');const seconds=retry&&/^\d+(\.\d+)?$/.test(retry)?Number(retry):10;await response.body?.cancel();if(seconds>120)throw Error('Synthetic auth retry exceeds limit.');await new Promise(done=>setTimeout(done,Math.max(1000,seconds*1000+200)));}throw Error('Synthetic auth rate limit persisted.');};
    const signIn=await post('/api/auth/sign-in/email',{email:actor.email,password:actor.password});if(!signIn.ok)throw Error(`Synthetic ${name} sign-in returned ${signIn.status}; inspect private log. Development uses Cloudflare public dummy verification and needs network access.`);update(signIn.headers);await signIn.body?.cancel();
    const active=await post('/api/auth/organization/set-active',{organizationId:actor.organizationId});if(!active.ok)throw Error(`Synthetic ${name} activation returned ${active.status}.`);update(active.headers);await active.body?.cancel();
    const target=name.endsWith('-manager')?fixture.actors[name.replace(/-manager$/,'-restricted')]:actor;
    result[name]={employeeId:actor.employeeId,targetEmployeeId:target.employeeId,targetEmployeeSearch:target.email,cookies:[...cookies.values()]};
    await writeFile(join(directory,'dev-auth-private.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(`Authenticated synthetic actor ${name}.`);
  }
} else if (command === 'mcp') {
  const call=async(method,params)=>{const response=await fetch(new URL('/_next/mcp',runtime.origin),{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})}),signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error(`MCP HTTP ${response.status}`);const raw=await response.text();if(response.headers.get('content-type')?.includes('text/event-stream')){const entries=raw.split(/\r?\n/).filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));return entries.find(entry=>entry.id===1)??entries;}return JSON.parse(raw);};
  const listed=await call('tools/list');await writeFile(join(directory,'mcp-tools-private.json'),JSON.stringify(listed,null,2),{mode:0o600});
  const results=[];for(const name of ['get_compilation_issues','get_errors'])results.push({name,result:await call('tools/call',{name,arguments:{}})});
  await writeFile(join(directory,'mcp-results-private.json'),JSON.stringify(results,null,2),{mode:0o600});console.log('Saved MCP diagnostics privately; inspect and redact before publication. Keep a browser connected for get_errors.');
} else throw Error('Usage: pnpm node runtime-helper.mjs <dev|auth|mcp> <repo> <new-private-fixture-directory> [actor-label ...]');
