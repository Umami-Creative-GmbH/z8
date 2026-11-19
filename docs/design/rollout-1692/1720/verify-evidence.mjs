import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const repo=process.cwd(),out=join(repo,'docs/design/rollout-1692/1720'),sharp=createRequire(join(repo,'apps/webapp/package.json'))('sharp');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),pins:[],images:[],json:[],limits:['Initial after-captures and retained failed-attempt dirty hashes are observations, not archived committed-source matches. Only named canonical observations are checked against their exact Git source below.']};
for(const name of ['before-captures.json','final-captures.json','actions.json','variants.json']){
 const item=JSON.parse(await readFile(join(out,name),'utf8'));
 for(const [path,expected] of Object.entries(item.source.hashes)){
  const bytes=execFileSync('git',['show',item.source.head+':'+path],{maxBuffer:10_000_000});
  const lf=bytes.toString('utf8').replaceAll('\r\n','\n'),crlf=lf.replaceAll('\n','\r\n');
  assert([sha(bytes),sha(lf),sha(crlf)].includes(expected),name+' pinned source '+path);
  result.pins.push({observation:name,head:item.source.head,path,hash:expected});
 }
}
for(const name of await readdir(out)){
 if(name.endsWith('.png')){const bytes=await readFile(join(out,name));const meta=await sharp(bytes).metadata();await sharp(bytes).raw().toBuffer();result.images.push({file:name,sha256:sha(bytes),png:[meta.width,meta.height]});}
 if(name.endsWith('.json')){JSON.parse(await readFile(join(out,name),'utf8'));result.json.push(name);}
}
for(const name of ['before-captures.json','after-captures.json','final-captures.json','variants.json','locale.json','scope.json','read-retry.json']){
 const item=JSON.parse(await readFile(join(out,name),'utf8'));
 for(const capture of item.results??item.captures??[]){const image=result.images.find(image=>image.file===capture.file);assert(image,capture.file);assert.deepEqual(image.png,capture.png,capture.file+' actual PNG dimensions');}
}
const report=await readFile(join(repo,'docs/design/rollout-1692/1720.md'),'utf8');
const links=[...report.matchAll(/\]\((1720\/[^)]+)\)/g)].map(match=>match[1]);for(const link of links)await readFile(join(repo,'docs/design/rollout-1692',link));result.links=links.length;
await writeFile(join(out,'evidence-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(`${result.pins.length} exact committed source pins, ${result.images.length} decoded PNGs, ${result.json.length} JSON files and ${result.links} report links verified.`);
