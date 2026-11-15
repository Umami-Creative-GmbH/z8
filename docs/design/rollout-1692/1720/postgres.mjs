// Same repository integration project, setup and disposable DB gate on Windows.
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {repo,runtime,pool} from './fixture.mjs';
await pool.end();
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const suites=['employee-uploads','document-requests','document-request-review','document-request-officer','personnel-file','officer-grants'].map(name=>`src/lib/personnel-file/${name}.integration.test.ts`);
const child=spawn(process.execPath,[join(repo,'apps/webapp/node_modules/vitest/vitest.mjs'),'run','--project','integration',...suites],{cwd:join(repo,'apps/webapp'),env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key))),...runtime.env},stdio:'inherit',windowsHide:true});
child.on('exit',code=>{process.exitCode=code??1;});
