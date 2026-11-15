// Temporarily restore only this ticket's owned source for matched historical captures.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const dir=join(process.cwd(),'.tmp/1721/baseline'),mode=process.argv[2];
const files=['apps/webapp/src/components/equipment/equipment-personal.tsx','apps/webapp/src/app/[locale]/(app)/my-equipment/page.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
await mkdir(dir,{recursive:true});
for(const [i,f] of files.entries()){
 if(mode==='before'){await writeFile(join(dir,String(i)),await readFile(f));await writeFile(f,execFileSync('git',['show',`006aff63207b4c4eedfc4e3544fcc61fc2dbccbf:${f}`]));}
 else {assert.equal(mode,'restore');await writeFile(f,await readFile(join(dir,String(i))));}
}
console.log(`Owned historical source ${mode}; added header/loading modules remain unused by baseline.`);
