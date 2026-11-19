import {readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,resolve,relative} from 'node:path';
const repo=process.cwd(),out='docs/design/rollout-1692/1739',base='58ea18603a936d102f0625e3303f4c05689a9961';
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=b=>Buffer.from(b.toString('utf8').replace(/\r\n/g,'\n'));
const fileInfo=path=>({path,bytes:readFileSync(path).length,sha256:sha(readFileSync(path)),canonicalSha256:sha(canonical(readFileSync(path)))});
mkdirSync(`${out}/logs`,{recursive:true});mkdirSync(`${out}/drivers`,{recursive:true});
for(const name of readdirSync('.tmp/1739-checks').filter(x=>/\.(log|raw)$/.test(x))){
 const bytes=readFileSync(`.tmp/1739-checks/${name}`);
 // Private runtime logs are deliberately not in this directory.
 writeFileSync(`${out}/logs/${name}.gz`,gzipSync(bytes));
}
for(const name of ['runtime.mjs','runtime-extra.mjs','runtime-extra-continuation.mjs','mcp.mjs','native.mjs','login.mjs','dev.mjs','check.mjs','runtime-final.mjs','native-final.mjs','login-final.mjs','final-setup.mjs','prepare-final-drivers.mjs','package-evidence.mjs'])copyFileSync(`.tmp/1739-checks/${name}`,`${out}/drivers/${name}`);
for(const name of ['runtime-incomplete-overlay.json','runtime-extra-incomplete.json','runtime-before-session-tightening.json','cleanup-first-fixture.json','doctor-before-fix.json','doctor-complexity.json','doctor.json','unit-results.json','owned-next-process.json','owned-next-process-final.json','final-types.json','cleanup-absence-final.json','issue-readback-final.json']){
 if(existsSync(`.tmp/1739-checks/${name}`))copyFileSync(`.tmp/1739-checks/${name}`,`${out}/${name}`);
}
const links=[];
for(const top of ['node_modules','apps/webapp/node_modules']){
 const directories=[top,...readdirSync(top).filter(n=>n.startsWith('@')).map(n=>join(top,n))];
 for(const dir of directories)for(const name of readdirSync(dir)){
  const path=join(dir,name);if(lstatSync(path).isSymbolicLink()){
   const actual=realpathSync(path);if(!actual.toLowerCase().startsWith(repo.toLowerCase()+'\\'))throw Error(`Borrowed package link: ${path}`);
   links.push({path,target:relative(repo,actual)});
  }
 }
}
const physical=['node_modules','apps/webapp/node_modules','node_modules/.pnpm'].map(path=>({path,symlink:lstatSync(path).isSymbolicLink(),realpath:realpathSync(path)}));
if(physical.some(x=>x.symlink))throw Error('Dependency directory is not physical');
const lock=fileInfo('pnpm-lock.yaml');if(lock.sha256.toUpperCase()!=='2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799')throw Error('Lock changed');
writeFileSync(`${out}/dependencies.json`,JSON.stringify({base,lock,physical,links,qualification:'Own frozen offline integrity/copy install. In-tree targets and physical directories checked; not a byte-pristine historical dependency certification.'},null,2));
const owned=['page.tsx','team-directory.tsx','team-directory-feedback.tsx','team-directory-records.tsx','team-directory.test.tsx','team-members-list.tsx','team-members-list.test.tsx'].map(n=>'apps/webapp/src/app/[locale]/(app)/team/'+n).concat(['apps/webapp/src/lib/navigation/route-metadata.ts','apps/webapp/src/lib/navigation/route-metadata.test.ts','scripts/performance/team-directory-fixture.mjs']);
const preserved=[...new Set(['apps/webapp/src/lib/reports/exporters/report-document-pdf.tsx','apps/webapp/src/components/reports/report-document-export-buttons.tsx','apps/webapp/src/components/reports/projects/report-share-link-list.tsx','apps/webapp/src/lib/query/use-employee-clock-statuses.ts','apps/webapp/src/components/work-balance/balance-adjustment-history-button.tsx','apps/webapp/src/components/settings/work-balance/use-employee-work-balance.ts','apps/webapp/src/components/employee-activity-text.tsx','apps/webapp/src/components/user-avatar.tsx','apps/webapp/src/app/[locale]/(app)/team/actions.ts','apps/webapp/src/app/[locale]/(app)/team/team-members-data.ts','apps/webapp/src/app/[locale]/(app)/team/team-time-balance.ts',...execFileSync('git',['ls-files','apps/webapp/src/components/reports','apps/webapp/src/lib/reports']).toString().trim().split('\n').filter(x=>/\.(ts|tsx)$/.test(x))])];
const ownerPins=preserved.filter(existsSync).map(path=>{
 const baseline=execFileSync('git',['show',`${base}:${path}`],{maxBuffer:10*1024*1024});
 const current=canonical(readFileSync(path));if(!baseline.equals(current))throw Error(`Preserved owner changed: ${path}`);
 return {...fileInfo(path),baselineCanonicalSha256:sha(baseline),unchanged:true};
});
const sources={base,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),owned:owned.map(fileInfo),preserved:ownerPins};
writeFileSync(`${out}/source.json`,JSON.stringify(sources,null,2));
const {directory}=JSON.parse(readFileSync('.tmp/1739-checks/private-pointer.json'));
const services=JSON.parse(readFileSync(join(directory,'services.json')));
if(services.label!=='z8-team-directory-fixture-1739'||services.containers.length!==3)throw Error('Cleanup ownership metadata invalid');
const containers=services.containers.map(name=>{
 const check=spawnSync('docker',['ps','-a','--filter',`name=^${name}$`,'--format','{{.Names}}'],{encoding:'utf8',windowsHide:true});
 if(check.status!==0||check.stdout.trim())throw Error(`Owned container remains: ${name}`);
 return {name,absent:true};
});
const runtime=JSON.parse(readFileSync(join(directory,'runtime-private.json')));
const next=JSON.parse(readFileSync('.tmp/1739-checks/owned-next-process-final.json','utf8').replace(/^\uFEFF/,''));
writeFileSync(`${out}/cleanup.json`,JSON.stringify({label:services.label,images:runtime.images,servicesManifestSha256:sha(readFileSync(join(directory,'services.json'))),runtimePrivateSha256:sha(readFileSync(join(directory,'runtime-private.json'))),fixturePrivateSha256:sha(readFileSync(join(directory,'fixture-private.json'))),containers,developmentPort:runtime.port,nextPids:next.map(x=>x.ProcessId),browserNamespace:'z8-1739',browserSession:'z8-1739-final',browserRestore:'not configured; close issued',qualification:'Private pointer/manifests and credentials were never copied to this artifact set. Exact PID/path/creation/parent metadata and cleanup command outputs retained. No peer process cleanup.'},null,2));
const inventory=[];
function walk(dir){for(const name of readdirSync(dir)){const path=join(dir,name);if(lstatSync(path).isDirectory())walk(path);else if(!path.endsWith('manifest.json'))inventory.push(fileInfo(path));}}
walk(out);inventory.push(fileInfo('docs/design/rollout-1692/1739.md'));writeFileSync(`${out}/manifest.json`,JSON.stringify({base,artifacts:inventory},null,2));
console.log(JSON.stringify({ownedSources:sources.owned.length,preservedOwners:ownerPins.length,packageLinks:links.length,artifacts:inventory.length,bytes:inventory.reduce((s,x)=>s+x.bytes,0)}));
