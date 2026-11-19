import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const repo=process.cwd(),dir=process.argv[2];
const require=createRequire(join(repo,'apps/webapp/package.json'));
const {Pool}=require('pg');
const services=JSON.parse(await readFile(join(dir,'services.json'),'utf8'));
for(const container of services.containers){
 const label=execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8',windowsHide:true}).trim();
 if(label!==services.label)throw Error('Fixture ownership mismatch');
}
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const url=new URL(runtime.env.DATABASE_URL || `postgresql://${runtime.env.POSTGRES_USER}:${runtime.env.POSTGRES_PASSWORD}@${runtime.env.POSTGRES_HOST}:${runtime.env.POSTGRES_PORT}/${runtime.env.POSTGRES_DB}`);
if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Not loopback');
const pool=new Pool({connectionString:url.href});
const database='approval_workflow_repository_test_1724_'+process.pid;
const os=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>os.test(key))),...runtime.env,pnpm_config_verify_deps_before_run:'false',SKIP_ENV_VALIDATION:'1',Z8_TEST_PROJECT:'integration',APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL:'approval-workflow-repository-test'};
try{
 await pool.query(`create database "${database}"`);
 url.pathname='/'+database;
 Object.assign(env,{APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL:url.href,POSTGRES_DB:database,PGOPTIONS:'-c statement_timeout=15000 -c timezone=UTC'});
 for(const args of [['--filter','webapp','exec','tsx','scripts/verify-approval-migration-recovery.ts'],['--filter','webapp','exec','vitest','run','--project','integration','src/app/[locale]/(app)/organization/org-explorer.integration.test.ts']]){
  const result=spawnSync(process.env.npm_execpath,args,{cwd:repo,env,windowsHide:true,stdio:'inherit'});
  if(result.status!==0)throw Error('Owned PostgreSQL check failed');
 }
}finally{await pool.query(`drop database if exists "${database}" with (force)`);await pool.end();console.log('Removed exact task-owned integration database.');}
