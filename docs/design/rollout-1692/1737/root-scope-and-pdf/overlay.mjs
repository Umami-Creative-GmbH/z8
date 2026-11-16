import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
const path='apps/webapp/src/components/reports/vehicles/vehicle-distance-report-container.tsx',backup='.tmp/1737-root-checks/vehicle-source-backup.txt',before='6d20638f06a1ebf84fd4db8c0c35a66c11da4089',after='2fceadad70ac1ebe8459c497de5f2496bce9ee82',canon=b=>b.toString('utf8').replaceAll('\r\n','\n');
const current=await readFile(path),old=execFileSync('git',['show',before+':'+path]),fixed=execFileSync('git',['show',after+':'+path]);
if(process.argv[2]==='before'){assert.equal(canon(current),canon(fixed));await copyFile(path,backup,1);await writeFile(path,canon(old).replaceAll('\n','\r\n'));}
else if(process.argv[2]==='after'){assert.equal(canon(current),canon(old));const saved=await readFile(backup);assert.equal(canon(saved),canon(fixed));await writeFile(path,saved);}
else throw Error('Expected before/after');console.log('Verified owned vehicle consumer-only '+process.argv[2]+' overlay. Current serializers/providers unchanged.');
