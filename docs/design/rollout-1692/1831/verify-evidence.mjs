import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const out=dirname(fileURLToPath(import.meta.url)),repo=resolve(out,'../../../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const json=async name=>JSON.parse(await readFile(join(out,name),'utf8'));
const before=await json('before.json'),overlay=await json('runtime.json'),actions=await json('default-actions.json'),final=await json('default-after.json'),handoff=await json('handoff.json');
for(const [file,expected] of [['page-before.tsx.txt',before.sourceSha256],['page-overlay-actions.tsx.txt',overlay.source['apps/webapp/src/app/[locale]/onboarding/vacation-policy/page-client.tsx']],['resolver-overlay.config.ts.txt',overlay.source['apps/webapp/next.config.ts']],['page-default-actions.tsx.txt',actions.sourceSha256],['page-after.tsx.txt',final.sourceSha256]])assert.equal(sha(await readFile(join(out,file))),expected,file);
assert.equal((await json('final-runtime.json')).sourceSha256,final.sourceSha256);
const sharp=createRequire(join(repo,'apps/webapp/package.json'))('sharp');
for(const item of handoff.pngs){const b=await readFile(join(out,item.file));assert.equal(sha(b),item.sha256,item.file);const {info}=await sharp(b).raw().toBuffer({resolveWithObject:true});assert.deepEqual([info.width,info.height],[item.width,item.height]);}
for(const file of await readdir(out))if(file.endsWith('.json'))await json(file);
if(process.argv.includes('--current-source')){
const normalize=b=>b.toString().replaceAll('\r\n','\n');assert.equal(normalize(await readFile(join(repo,'apps/webapp/src/app/[locale]/onboarding/vacation-policy/page-client.tsx'))),normalize(await readFile(join(out,'page-after.tsx.txt'))));
assert.equal(sha(await readFile(join(repo,'apps/webapp/next.config.ts'))),handoff.defaultConfigSha256);
}
console.log(`Verified source pins, ${handoff.pngs.length} full PNG decodes, JSON and ${process.argv.includes('--current-source')?'current-source':'archived-source'} contract.`);
