import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const repo=process.cwd(),dir=join(repo,'docs/design/rollout-1692/1721'),sharp=createRequire(join(repo,'apps/webapp/package.json'))('sharp');
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),json:[],png:[],finalSourcePins:[],baselineSourcePins:[]};
for(const name of await readdir(dir)){
 if(name.endsWith('.json')){JSON.parse(await readFile(join(dir,name),'utf8'));report.json.push(name);}
 if(name.endsWith('.png')){const bytes=await readFile(join(dir,name));const m=await sharp(bytes).metadata();await sharp(bytes).raw().toBuffer();report.png.push({name,width:m.width,height:m.height,sha256:createHash('sha256').update(bytes).digest('hex')});}
}
const before=JSON.parse(await readFile(join(dir,'before.json'),'utf8')),after=JSON.parse(await readFile(join(dir,'after.json'),'utf8'));
assert.equal(before.observations.length,3);assert.equal(after.observations.length,3);
for(const ob of after.observations){
 assert.equal(ob.fontsStatus,'loaded');assert.equal(ob.scrollWidth,ob.cssViewport.width);assert.equal(ob.headings.filter(h=>h==='My equipment').length,1);
 for(const [file,hash] of Object.entries(ob.identity.hashes)){assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),hash);report.finalSourcePins.push({capture:ob.name,file,hash});}
 const png=report.png.find(p=>p.name===`after-${ob.name}.png`);assert.equal(png.width,ob.png.width);assert.equal(png.height,ob.png.height);
}
for(const ob of before.observations)for(const file of ['apps/webapp/src/components/equipment/equipment-personal.tsx','apps/webapp/src/app/[locale]/(app)/my-equipment/page.tsx','apps/webapp/src/lib/navigation/route-metadata.ts']){const blob=execFileSync('git',['show',`006aff63207b4c4eedfc4e3544fcc61fc2dbccbf:${file}`]);assert.equal(createHash('sha256').update(blob).digest('hex'),ob.identity.hashes[file]);report.baselineSourcePins.push({capture:ob.name,file});}
const runtime=JSON.parse(await readFile(join(dir,'runtime.json'),'utf8'));assert.equal(runtime.checks.length,24);assert.deepEqual(runtime.failures,[]);assert.deepEqual(runtime.errors,[]);assert.ok(runtime.snapshots.find(s=>s.name==='after-last-record').observation.text.includes('R029 Lost kit'));
for(const s of runtime.snapshots)for(const [file,hash] of Object.entries(s.hashes))assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),hash);
await writeFile(join(dir,'evidence-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(`Verified ${report.png.length} decoded PNGs, ${report.json.length} JSONs, ${report.finalSourcePins.length} final and ${report.baselineSourcePins.length} baseline source pins; 24 runtime checks.`);
