// pnpm node docs/design/rollout-1692/1830/verify-evidence.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
const dir='docs/design/rollout-1692/1830',json=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const [before,after,actions,scope]=await Promise.all(['before.json','after.json','actions.json','scope.json'].map(json));
const profile='apps/webapp/src/app/[locale]/onboarding/profile/page-client.tsx';
const current=hash(await readFile(profile));assert.equal(after.source.files[profile],current);assert.equal(actions.source.files[profile],current);assert.equal(scope.source.profileSha256,current);
assert.equal(before.source.files[profile],hash(execFileSync('git',['show','19862ee6586b4e07831c6f5a8b7e06d0f698cedd:'+profile])));
for(const [name,pin] of Object.entries(after.source.files))assert.equal(hash(await readFile(name)),pin,name);
for(const capture of before.captures){const match=after.captures.find(c=>c.name===capture.name);assert.deepEqual(match,capture);}
assert.equal(after.focusReturn,true);assert.equal(before.focusReturn,true);assert.equal(after.calendar320.right<=320,true);assert.equal(scope.checks.length,4);assert.equal(actions.errors.length,0);
const require=createRequire(resolve('apps/webapp/package.json')),sharp=require('sharp');const pictures=[];
for(const name of await readdir(dir))if(name.endsWith('.png')){const path=join(dir,name),buffer=await readFile(path);const {info}=await sharp(buffer).raw().toBuffer({resolveWithObject:true});pictures.push({name,sha256:hash(buffer),width:info.width,height:info.height});}
const base=process.argv[2]??(await json('quality.json')).latestLocalAIAncestor;execFileSync('git',['merge-base','--is-ancestor',base,'HEAD']);
const allChanges=execFileSync('git',['diff','--name-only',base],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const changed=allChanges.filter(p=>!p.startsWith(dir+'/')&&p!=='docs/design/rollout-1692/1830.md');
assert.deepEqual(changed.sort(),['apps/webapp/src/app/[locale]/onboarding/profile/actions.test.ts','apps/webapp/src/app/[locale]/onboarding/profile/page-client.tsx','apps/webapp/src/app/[locale]/onboarding/profile/page.test.tsx','apps/webapp/src/lib/validations/onboarding.ts'].sort());
const result={base,profileSha256:current,matchedPairs:before.captures.length,decodedPngs:pictures.length,actionAssertions:actions.checks.length,realScopeCases:scope.checks.length,trackedSourcePaths:changed,priorTrackedRolloutPathsPreserved:execFileSync('git',['ls-tree','-r','--name-only',base,'docs/design/rollout-1692'],{encoding:'utf8'}).trim().split(/\r?\n/).length,pictures};
await writeFile(join(dir,'artifact-audit.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({matchedPairs:result.matchedPairs,decodedPngs:result.decodedPngs,actions:result.actionAssertions,scope:result.realScopeCases,preserved:result.priorTrackedRolloutPathsPreserved}));
