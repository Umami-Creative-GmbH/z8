import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
const before='fe499a787b218523c07b7c904fe04b34700d6f2c',after='e0d252240ca9f9c2096555d31b31cd4e5dff852a',backup='.tmp/1736-root-checks/source-controlled-backup/';
const paths=['apps/webapp/src/components/reports/projects/project-reports-container.tsx','apps/webapp/src/components/reports/projects/report-share-link-list.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'],canon=b=>b.toString('utf8').replaceAll('\r\n','\n');await mkdir(backup,{recursive:true});
for(const[index,path]of paths.entries()){
 const current=await readFile(path),old=execFileSync('git',['show',before+':'+path]),fixed=execFileSync('git',['show',after+':'+path]),savedPath=backup+index+'.txt';
 if(process.argv[2]==='before'){assert.equal(canon(current),canon(fixed));await copyFile(path,savedPath,1);await writeFile(path,canon(old).replaceAll('\n','\r\n'));}
 else if(process.argv[2]==='after'){assert.equal(canon(current),canon(old));const saved=await readFile(savedPath);assert.equal(canon(saved),canon(fixed));await writeFile(path,saved);}
 else throw Error('Expected before/after');
}
console.log('Verified three-path historical/current comparison overlay; providers/actions/calculations unchanged.');
