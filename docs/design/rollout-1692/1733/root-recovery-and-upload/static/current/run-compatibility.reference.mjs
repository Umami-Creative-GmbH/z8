// SANITIZED PUBLIC REFERENCE CLONE; DO NOT EXECUTE. Explicit __PLACEHOLDERS__ replace machine/scratch pointers.
// This models the test-server transport boundary; it does not reproduce canonical storage, authentication, or PostgreSQL.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
mkdirSync('__CURRENT_SOURCE_CHECK_SCRATCH__',{recursive:true});
const original=JSON.parse(readFileSync('__HISTORICAL_COMMAND_CHECK_SCRATCH__/unit-command.json','utf8'));
const args=original.args.slice(0,original.args.indexOf('--reporter=json'));
args.push('src/components/personnel-file/use-payslip-batch-upload.browser.test.ts','--reporter=json','--outputFile=../../__CURRENT_SOURCE_CHECK_SCRATCH__/unit-final.json');
const env={...process.env,pnpm_config_verify_deps_before_run:'false',Z8_TEST_CHROME_PATH:'__CHROME_EXECUTABLE__'};
const result=spawnSync(original.executable,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:10*1024*1024});
writeFileSync('__CURRENT_SOURCE_CHECK_SCRATCH__/unit-final.log',(result.stdout??'')+(result.stderr??''));
writeFileSync('__CURRENT_SOURCE_CHECK_SCRATCH__/unit-command.json',JSON.stringify({executable:original.executable,args,exit:result.status,error:result.error?.message},null,2)+'\n');
if(result.status===0){const report=JSON.parse(readFileSync('__CURRENT_SOURCE_CHECK_SCRATCH__/unit-final.json','utf8'));console.log(JSON.stringify({files:report.testResults.length,total:report.numTotalTests,passed:report.numPassedTests,failed:report.numFailedTests,pending:report.numPendingTests}));}
else console.log((result.stdout??'')+(result.stderr??''));
process.exitCode=result.status??1;
