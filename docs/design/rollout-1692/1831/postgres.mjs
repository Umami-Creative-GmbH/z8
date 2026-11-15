import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {repo,runtime,pool} from '../1719/fixture.mjs';
await pool.end();
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const suites=['vacation-accrual','assigned-vacation-postings','working-week-allowance','vacation-policy-resolution'].map(name=>`src/lib/absences/${name}.integration.test.ts`);
const child=spawn(process.execPath,[join(repo,'apps/webapp/node_modules/vitest/vitest.mjs'),'run','--project','integration',...suites,'--reporter=json',`--outputFile=${join(repo,'.tmp/1831-postgres.json')}`],{cwd:join(repo,'apps/webapp'),env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key))),...runtime.env},stdio:'inherit',windowsHide:true});
child.once('exit',code=>{process.exitCode=code??1;});
