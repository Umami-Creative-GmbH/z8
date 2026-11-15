// Starts only this checkout against this ticket's generated disposable services.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
const dir=resolve(process.argv[2]),root=process.cwd(),app=join(root,'apps/webapp');
const r=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const f=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
assert.equal(f.kind,'disposable');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|SWC_NATIVE_BINDING_CACHE)$/i.test(k)));
Object.assign(env,r.env,{NODE_ENV:'development',TELEMETRY_ENABLED:'false',BILLING_ENABLED:'false',ENABLE_CRON_JOBS:'false',NEXT_TELEMETRY_DISABLED:'1',REDIS_TLS:'false',S3_PRIVATE_BUCKET:r.env.S3_PUBLIC_BUCKET,S3_PRIVATE_ACCESS_KEY_ID:r.env.S3_PUBLIC_ACCESS_KEY_ID,S3_PRIVATE_SECRET_ACCESS_KEY:r.env.S3_PUBLIC_SECRET_ACCESS_KEY,S3_PRIVATE_ENDPOINT:r.env.S3_PUBLIC_ENDPOINT,S3_PRIVATE_REGION:'us-east-1',S3_PRIVATE_FORCE_PATH_STYLE:'true'});
const log=createWriteStream(join(dir,'next.log'));await once(log,'open');
const child=spawn(process.execPath,[join(app,'node_modules/next/dist/bin/next'),'dev','--turbopack','--port',String(r.port)],{cwd:app,env,stdio:['ignore',log,log],windowsHide:true});
await once(child,'spawn');await writeFile(join(dir,'next-process.json'),JSON.stringify({pid:child.pid,checkout:root,app,port:r.port,command:'next dev --turbopack'}));console.log(JSON.stringify({pid:child.pid,port:r.port}));await once(child,'exit');log.end();
