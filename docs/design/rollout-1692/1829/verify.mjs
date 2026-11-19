// pnpm node verify.mjs <explicit checkout> <private fixture>; never emits secret values.
import assert from 'node:assert/strict';import{readFile,readdir,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import{createRequire}from'node:module';import{join,resolve}from'node:path';
const[checkout,input]=process.argv.slice(2),repo=resolve(checkout),dir=resolve(input),out=join(repo,'docs/design/rollout-1692/1829');
const json=async p=>JSON.parse(await readFile(p,'utf8')),after=await json(join(out,'after-runtime.json')),before=await json(join(out,'before-runtime.json'));
const req=createRequire(join(repo,'apps/webapp/package.json')),sharp=createRequire(req.resolve('next/package.json'))('sharp');
const owned=['apps/webapp/src/app/[locale]/onboarding/organization/organization-page-client.tsx','apps/webapp/src/app/[locale]/onboarding/organization/page.tsx'];
for(const c of after.captures)for(const p of owned)assert.equal(c.source.hashes[p],createHash('sha256').update(await readFile(join(repo,p))).digest('hex'),`Final capture source ${p}`);
assert.equal(before.captures.length,13);assert.equal(after.captures.length,13);
for(const mode of [before,after])for(const c of mode.captures){assert.equal(c.width,c.documentWidth);assert.ok(['16px','18px'].includes(c.rootFont));assert.equal(c.fonts,'loaded');}
const artifacts=(await readdir(out,{recursive:true})).map(p=>join(out,p));let decoded=0;
for(const p of artifacts.filter(p=>p.endsWith('.png'))){const{data,info}=await sharp(p).raw().toBuffer({resolveWithObject:true});assert.ok(data.length>0&&info.width>0&&info.height>0);decoded++;}
const runtime=await json(join(dir,'runtime-private.json')),fixture=await json(join(dir,'fixture-private.json'));assert.equal(fixture.kind,'disposable');
const secrets=new Set();for(const[k,v]of Object.entries(runtime.env))if(/PASSWORD|SECRET|TOKEN|PRIVATE_KEY/.test(k)&&typeof v==='string'&&v.length>12)secrets.add(v);
for(const a of Object.values(fixture.actors))if(a.password)secrets.add(a.password);
for(const name of ['organization-private.json','created-actor-private.json','dev-auth-private.json']){try{const text=await readFile(join(dir,name),'utf8');const obj=JSON.parse(text);if(obj.password)secrets.add(obj.password);for(const c of obj.cookies||[])if(c.value.length>12)secrets.add(c.value);for(const a of Object.values(obj))for(const c of a?.cookies||[])if(c.value.length>12)secrets.add(c.value);}catch(error){if(error.code!=='ENOENT')throw error;}}
for(const p of artifacts.filter(p=>/\.(json|mjs|ps1|md)$/.test(p))){const text=await readFile(p,'utf8');assert.ok(![...secrets].some(s=>text.includes(s)),`Secret leak in artifact ${p}`);}
const unit=await json(join(out,'final-unit.json')),postgres=await json(join(out,'postgres.json')),quality=await json(join(out,'quality.json'));assert.equal(unit.numFailedTests,0);assert.equal(postgres.numFailedTests,0);assert.ok(quality.commands.length===5&&quality.commands.every(c=>c.exitCode===0));
const result={finalOwnedSourceMatchesAllAfterCaptures:true,beforeCaptures:before.captures.length,afterCaptures:after.captures.length,decodedPNGs:decoded,artifactSecretScan:'passed; private values never emitted',unit:{files:unit.testResults.length,tests:unit.numTotalTests},postgres:{files:postgres.testResults.length,tests:postgres.numTotalTests},qualityCommands:quality.commands.length};
await writeFile(join(out,'evidence-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
