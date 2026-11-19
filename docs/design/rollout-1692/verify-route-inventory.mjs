import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const [repoArg,commitArg,outArg]=process.argv.slice(2),repo=resolve(repoArg);
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});
const commit=git('rev-parse',`${commitArg}^{commit}`).trim();
const blob=(file,at=commit)=>git('show',`${at}:${file}`);
const ledger=JSON.parse(blob('docs/design/rollout-1692/integration.json').replace(/^\uFEFF/,''));
const publication=blob('docs/design/2026-11-14-webapp-ui-ux-publication.md');
const pages=git('ls-tree','-r','--name-only',commit,'--','apps/webapp/src/app').trim().split('\n').filter(file=>file.endsWith('/page.tsx')).map(file=>{
 const parts=file.replace('apps/webapp/src/app/','').replace(/\/page\.tsx$/,'').split('/').filter(part=>part!=='[locale]'&&!(part.startsWith('(')&&part.endsWith(')')));
 return {route:parts.length?'/'+parts.join('/'):'/',file};
});
const aliasSection=publication.slice(publication.indexOf('## Redirect aliases'));
const aliases=aliasSection.split(/\r?\n/).filter(line=>/^\| R\d+ \|/.test(line)).map(line=>{
 const [id,route,destination,query,owner]=line.split('|').slice(1,-1).map(part=>part.trim().replace(/`/g,''));
 return {id,route,destination,query:query==='None'?null:query,issue:Number(owner.match(/#(\d+)/)[1])};
});
const persistent=ledger.tickets.filter(t=>t.route);
assert.equal(persistent.length,153);assert.equal(aliases.length,19);assert.equal(pages.length,172);
const expected=new Set([...persistent.map(t=>t.route),...aliases.map(t=>t.route)]);
assert.equal(expected.size,172);assert.equal(new Set(pages.map(p=>p.route)).size,172);
assert.deepEqual(pages.map(p=>p.route).sort(),[...expected].sort());
const base=git('rev-parse',`${ledger.devBase}^{commit}`).trim();
for(const alias of aliases){
 const owner=persistent.find(t=>t.issue===alias.issue);assert.ok(owner);assert.equal(owner.route,alias.destination);
 alias.file=pages.find(p=>p.route===alias.route).file;
 alias.currentBlob=git('rev-parse',`${commit}:${alias.file}`).trim();
 alias.baseBlob=git('rev-parse',`${base}:${alias.file}`).trim();
 alias.byteUnchangedFromInitialDev=alias.currentBlob===alias.baseBlob;
}
const result={kind:'static source-template inventory only',commit,initialDev:base,counts:{persistentPages:persistent.length,redirectAliases:aliases.length,sourcePageTemplates:pages.length,aliasTemplatesUnchangedFromInitialDev:aliases.filter(a=>a.byteUnchangedFromInitialDev).length},coverage:'Every source page template maps exactly once to the approved persistent-page or redirect-alias inventory, and every alias destination/owner matches its ledger page issue.',limits:['Source coverage and blob equality do not prove locale/query/access behavior at runtime.','All19 alias contracts still require their destination-ticket acceptance and final integration verification.','No full route/role/domain/browser/build/catalog certification follows.'],persistent:persistent.map(t=>({id:t.id,issue:t.issue,route:t.route,file:pages.find(p=>p.route===t.route).file})),aliases};
await writeFile(resolve(outArg),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({commit,...result.counts,classification:result.kind}));
