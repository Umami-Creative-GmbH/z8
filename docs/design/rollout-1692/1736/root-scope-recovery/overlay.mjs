import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
const before='fe499a787b218523c07b7c904fe04b34700d6f2c',after='0fa4e6c93edf6d09ccfd04580811364a149bf774',root='apps/webapp/src/components/reports/projects/',backup='.tmp/1736-root-checks/source-before-backup/';
const canon=b=>b.toString('utf8').replaceAll('\r\n','\n');await mkdir(backup,{recursive:true});
for(const name of ['project-reports-container.tsx','report-share-link-list.tsx']){
 const path=root+name,current=await readFile(path),old=execFileSync('git',['show',before+':'+path]),fixed=execFileSync('git',['show',after+':'+path]);
 if(process.argv[2]==='before'){assert.equal(canon(current),canon(fixed));await copyFile(path,backup+name,1);await writeFile(path,canon(old).replaceAll('\n','\r\n'));}
 else if(process.argv[2]==='after'){assert.equal(canon(current),canon(old));const saved=await readFile(backup+name);assert.equal(canon(saved),canon(fixed));await writeFile(path,saved);}
 else throw Error('Expected before/after');
}
console.log('Verified owned report-consumer-only '+process.argv[2]+' overlay. Providers/actions/PDF remain current.');
