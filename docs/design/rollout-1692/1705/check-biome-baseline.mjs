// Compare the two existing broad files at identical stdin/config boundaries.
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
const files=['src/lib/analytics/types.ts','src/lib/effect/services/analytics.service.ts'];
const results=[];
for(const file of files){
 const current=await readFile(resolve('apps/webapp',file),'utf8');
 const base=execFileSync('git',['show',`ai/1692-app-wide-ui-refresh:apps/webapp/${file}`],{encoding:'utf8',windowsHide:true});
 const baselinePath=resolve('apps/webapp',file.replace(/\.ts$/,'.baseline-1705.ts'));
 await writeFile(baselinePath,base);
 const scan=path=>{const args=['exec','biome','check',path,'--reporter=json'];const exe=process.env.npm_execpath;const r=spawnSync(exe.endsWith('.exe')?exe:process.execPath,exe.endsWith('.exe')?args:[exe,...args],{cwd:resolve('apps/webapp'),encoding:'utf8',windowsHide:true});const parsed=JSON.parse(r.stdout);return parsed.diagnostics.map(d=>({category:d.category,severity:d.severity,description:d.description})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));};
 let before,after;try {before=scan(baselinePath);after=scan(file);}finally{await unlink(baselinePath);}

 assert.deepEqual(after,before);results.push({file,unchanged:true,diagnostics:after});
}
await writeFile('docs/design/rollout-1692/1705/biome-baseline.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
