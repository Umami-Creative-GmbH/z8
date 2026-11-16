import {readFile,writeFile,lstat,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const out=resolve('.tmp/1732-root-checks/runtime');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=[
'apps/webapp/src/app/[locale]/(app)/personnel-files/payslip-batches/page.tsx',
'apps/webapp/src/app/[locale]/(app)/personnel-files/payslip-batches/actions.ts',
'apps/webapp/src/components/personnel-file/payslip-batch-start.tsx',
'apps/webapp/src/components/personnel-file/payslip-batch-start.test.tsx',
'apps/webapp/src/components/personnel-file/payslip-batches-heading.tsx',
'apps/webapp/src/components/personnel-file/payslip-batches-loading.test.tsx',
'apps/webapp/src/components/personnel-file/payslip-batches-scope.tsx',
'apps/webapp/src/lib/navigation/route-metadata.ts',
'apps/webapp/src/lib/navigation/route-metadata.test.ts',
'apps/webapp/src/lib/personnel-file/payslip-batch.integration.test.ts',
'apps/webapp/src/components/site-header.tsx',
'apps/webapp/src/components/providers/organization-context-provider.tsx'];
const pins=[];for(const path of paths){const b=await readFile(path);pins.push({path,raw:sha(b),lf:sha(b.toString().replaceAll('\r\n','\n'))});}
const tracked=git('ls-files').split('\n');
const configs=tracked.filter(p=>/(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|next\.config\.[^/]+|vitest\.config\.[^/]+|biome\.jsonc?|tsconfig[^/]*\.json)$/.test(p));
const configPins=[];for(const path of configs)configPins.push({path,sha256:sha(await readFile(path))});
const parents=[];for(const p of ['node_modules','node_modules/.pnpm','apps/webapp/node_modules']){const s=await lstat(p);parents.push({path:p,physical:s.isDirectory()&&!s.isSymbolicLink()});}
let links=0;for(const p of ['node_modules','apps/webapp/node_modules']){for(const x of await readdir(p)){if(x.startsWith('@')){for(const n of await readdir(join(p,x))){if((await lstat(join(p,x,n))).isSymbolicLink())links++;}}else if((await lstat(join(p,x))).isSymbolicLink())links++;}}
const proofPaths=tracked.filter(p=>p.startsWith('docs/design/rollout-1692/'));
const proofPins=git('ls-tree','-r','HEAD','--','docs/design/rollout-1692/');
const ledgerText=await readFile('docs/design/rollout-1692/README.md','utf8');
const result={head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),branch:git('branch','--show-current'),status:git('status','--porcelain'),pins,configPins,configCount:configPins.length,dependencyParents:parents,outerLinks:links,lock:sha(await readFile('pnpm-lock.yaml')).toUpperCase(),proofPaths:proofPaths.length,proofDigest:sha(JSON.stringify(proofPins)),ledgerReadme:sha(ledgerText)};
await writeFile(join(out,process.argv[2]??'source-start.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head:result.head,clean:!result.status,parents:parents.length,allPhysical:parents.every(p=>p.physical),links,lock:result.lock,configCount:result.configCount,proofPaths:result.proofPaths}));
