// Existing real integration gate/setup on the owned, migrated disposable fixture.
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {repo,runtime,pool} from '../1719/fixture.mjs';
await pool.end();
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const suites=['grant-holder-export','comparison-service','baseline-evidence','comparison-explanations','overtime-payouts'].map(name=>`src/lib/payroll-export/${name}.integration.test.ts`);
const child=spawn(process.execPath,[join(repo,'apps/webapp/node_modules/vitest/vitest.mjs'),'run','--project','integration',...suites],{cwd:join(repo,'apps/webapp'),env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key))),...runtime.env},stdio:'inherit',windowsHide:true});
child.on('exit',code=>{process.exitCode=code??1;});
