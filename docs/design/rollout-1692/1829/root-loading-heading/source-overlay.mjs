import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const out='.tmp/1829-root-checks/',path='apps/webapp/src/app/[locale]/onboarding/organization/organization-page-client.tsx',base='9847f784dfcdca922fd41936493ea07d4b896675',sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'fix/1829-organization-loading-heading');
if(process.argv[2]==='before'){const after=await readFile(path),before=execFileSync('git',['show',base+':'+path]);assert.notEqual(sha(before),sha(after));await writeFile(out+'source-before.tsx.txt',before);await writeFile(out+'source-after.tsx.txt',after);await writeFile(out+'source-overlay.json',JSON.stringify({path,base,before:sha(before),after:sha(after),scope:'One exact organization consumer over current infrastructure and identical fixture'},null,2)+'\n');await writeFile(path,before);}else if(process.argv[2]==='restore'){const m=JSON.parse(await readFile(out+'source-overlay.json','utf8'));assert.equal(sha(await readFile(path)),m.before,'Unexpected intervening source edit');const bytes=await readFile(out+'source-after.tsx.txt');assert.equal(sha(bytes),m.after);await writeFile(path,bytes);}else throw Error('Use before or restore');
