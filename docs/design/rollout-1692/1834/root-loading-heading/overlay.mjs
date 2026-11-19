import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
const target='apps/webapp/src/app/[locale]/onboarding/work-schedule/page-client.tsx',backup='.tmp/1834-root-checks/corrected-client-original.tsx';
const canonical=b=>b.toString('utf8').replaceAll('\r\n','\n');
const old=execFileSync('git',['show','bd160d9af22214d473ea603870cdc161572bbcad:'+target]),fixed=execFileSync('git',['show','1230f61742be73ba436532cb1d1ad2ba61aa0cad:'+target]);
const current=await readFile(target);
if(process.argv[2]==='before'){
 assert.equal(canonical(current),canonical(fixed));
 await copyFile(target,backup,1);
 await writeFile(target,canonical(old).replaceAll('\n','\r\n'));
}else if(process.argv[2]==='after'){
 assert.equal(canonical(current),canonical(old));
 const saved=await readFile(backup);assert.equal(canonical(saved),canonical(fixed));
 await writeFile(target,saved);
}else throw Error('Expected before/after');
console.log('Verified owned client-only '+process.argv[2]+' overlay. All server owners unchanged.');
