import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('.'),out=join(root,'docs/design/rollout-1692/1738');
const require=createRequire(join(root,'apps/webapp/package.json'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>{const p=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});return p.status===0?p.stdout.trim():null;};
const files=JSON.parse(await readFile('.tmp/1738/owned-files.json','utf8'));
const comparison=[];
for(const f of files){const file='apps/webapp/'+f;comparison.push({file,metadataBlob:git('rev-parse',`58ea18603a936d102f0625e3303f4c05689a9961:${file}`),verifiedBlob:git('rev-parse',`ca6f607d683c69ee47e7558fae78b1dcd1b53914:${file}`),finalBlob:git('hash-object',file),finalSha256:sha(await readFile(file))});}
await writeFile(join(out,'consumer-comparison.json'),JSON.stringify({metadata:'58ea18603a936d102f0625e3303f4c05689a9961',verified:'ca6f607d683c69ee47e7558fae78b1dcd1b53914',comparison},null,2));
const topology={};for(const p of ['node_modules','node_modules/.pnpm','apps/webapp/node_modules']){const {realpath,lstat}=await import('node:fs/promises');topology[p]={realpath:await realpath(p),symbolicLink:(await lstat(p)).isSymbolicLink()};}
for(const p of ['next','react','vitest','babel-plugin-react-compiler'])topology[p]=require.resolve(p);
const license=await readFile('apps/webapp/src/data/licenses.json');
await writeFile(join(out,'dependency-provenance.json'),JSON.stringify({lockSha256:sha(await readFile('pnpm-lock.yaml')),topology,license:{tool:'cached license-report 6.8.6',sha256:sha(license),entries:JSON.parse(license.toString()).length},install:'frozen offline ignore-scripts verify-store-integrity=true package-import-method=copy; owned physical directories'},null,2));
const png=await readFile(join(out,'before-login-blocked.png'));
await writeFile(join(out,'capture-boundary.json'),JSON.stringify({capture:'before-login-blocked.png',sha256:sha(png),width:png.readUInt32BE(16),height:png.readUInt32BE(20),source:'58ea18603a936d102f0625e3303f4c05689a9961; no product edits at capture',fixture:'new label z8-scheduling-fixture-1738; small-admin normal auth attempted',actual:'unauthenticated sign-in, HTTP 400 TURNSTILE_REQUIRED',beforeAfterScheduling:'not captured; blocked; screenshot is not scheduling acceptance',finalSource:'checks/source-36c60f925612dbdab3e9ba5b6166dd816325300ee4ebe124726dd230a3b7f51d.json'},null,2));
await mkdir(join(out,'harness'),{recursive:true});for(const f of ['fixture.mjs','dev.mjs','browser.mjs','seed.mjs','check.mjs','mcp.mjs','owned-files.json','agent-browser-guide.txt'])await writeFile(join(out,'harness',f),await readFile(join('.tmp/1738',f)));
const summaries=[];for(const f of await readdir(join(out,'checks'))){if(!f.endsWith('.json')||f.startsWith('source-'))continue;summaries.push(JSON.parse(await readFile(join(out,'checks',f),'utf8')));}
await writeFile(join(out,'checks','run-index.json'),JSON.stringify(summaries,null,2));console.log('Wrote credential-free source/consumer/dependency/capture manifests and own harness source.');
