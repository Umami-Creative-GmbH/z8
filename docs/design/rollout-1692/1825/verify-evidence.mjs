// pnpm node docs/design/rollout-1692/1825/verify-evidence.mjs <owned-private-fixture>
// Publishes only reviewed diagnostics, never private env/cookies/manifests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const out='docs/design/rollout-1692/1825', privateDir=process.argv[2];
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const save=async(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2));
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const source={head:git('rev-parse','HEAD'),integration:git('rev-parse','ai/1692-app-wide-ui-refresh'),dirty:git('status','--porcelain','--untracked-files=no'),hashes:{}};
execFileSync('git',['merge-base','--is-ancestor',source.integration,'HEAD']);
const sameProductSource=ref=>{execFileSync('git',['merge-base','--is-ancestor',ref,'HEAD']);assert.equal(git('diff',ref,'HEAD','--','apps','packages','scripts','package.json','pnpm-lock.yaml'),'');};
const before=await read(join(out,'before-runtime.json')),final=await read(join(out,'final-runtime.json')),combined=await read(join(out,'combined-runtime.json'));
const runtimeHead=final.captures[0].source.head;sameProductSource(runtimeHead);
for(const file of Object.keys(final.captures[0].source.hashes))source.hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const modes=[];
for(const result of [before,final,combined]) {
 assert.deepEqual(result.pageErrors,[]);assert.equal(result.report.sha256,before.report.sha256);assert.equal(result.report.packages,125);assert.equal(result.report.licenses.length,12);
 for(const capture of result.captures) {
  const image=await readFile(join(out,`${result.mode}-${capture.label}.png`));assert.equal(image.subarray(1,4).toString(),'PNG');
  assert.equal(capture.width,capture.documentWidth);assert.equal(capture.heading.length,1);
  if(result!==before)assert.deepEqual(capture.source.hashes,source.hashes);
 }
 for(const label of ['desktop-light','phone-light','wide-dark','phone-dark-large']) {
  const capture=result.captures.find(x=>x.label===label);assert.equal(capture.rows,125);assert.ok(capture.localScroll.scrollHeight>capture.localScroll.height);
 }
 const large=result.captures.find(x=>x.label==='phone-dark-large');assert.equal(large.fontPx,'18px');assert.equal(large.fontPreference,'large');assert.equal(large.dark,true);
 assert.ok(result.actions.some(x=>x.task.includes('last full-report')&&x.visible&&x.scrollTop>0));
 const keyboard=result.actions.find(x=>x.task.includes('keyboard-focus'));assert.equal(keyboard.focus.focusVisible,true);assert.ok(!keyboard.focus.shadow.includes('oklab(0 0 0 / 0)'));
 modes.push({mode:result.mode,captures:result.captures.length,actions:result.actions.length,pageErrors:result.pageErrors.length,sourceHeads:[...new Set(result.captures.map(x=>x.source.head))]});
}
const matched=before.captures.map(b=>{const f=final.captures.find(x=>x.label===b.label);assert.ok(f);assert.equal(f.width,b.width);assert.equal(f.height,b.height);assert.equal(f.fontPx,b.fontPx);assert.equal(f.rows,b.rows);return b.label;});
const mcp=await read(join(privateDir,'mcp-results-private.json'));
const results=mcp.map(item=>({name:item.name,result:JSON.parse(item.result.result.content.find(x=>x.type==='text').text)}));
assert.deepEqual(results.find(x=>x.name==='get_compilation_issues').result,{issues:[]});assert.deepEqual(results.find(x=>x.name==='get_errors').result,{configErrors:[],sessionErrors:[]});
const listed=await read(join(privateDir,'mcp-tools-private.json'));const tools=listed.result.tools.map(x=>x.name);assert.ok(tools.includes('get_compilation_issues'));
const diagnosticSource=(await read(join(out,'next-runtime.json'))).source;
sameProductSource(diagnosticSource.head);assert.deepEqual(diagnosticSource.hashes,source.hashes);
await save('next-runtime.json',{source:diagnosticSource,tools,results});
const nativeBytes=await readFile(join(privateDir,'react-private.json'),'utf8'),native=JSON.parse(nativeBytes);assert.equal(native.success,true);
const evidenceLines=native.data.tree.split('\n').filter(x=>/LicenseTable|DataTableToolbar|InfoHeader|InfoFooter|AuthShellControls/.test(x));assert.ok(evidenceLines.some(x=>x.includes('LicenseTable')));assert.ok(evidenceLines.some(x=>x.includes('DataTableToolbar')));
const axe=await read(join(privateDir,'axe-private.json'));
await save('react-runtime.json',{source:diagnosticSource,driver:'agent-browser 0.39.1 native --enable react-devtools',session:'r026-5b11e61fd47f',actualTreeEvidence:evidenceLines,outputSha256:createHash('sha256').update(nativeBytes).digest('hex'),axe:{counts:axe.data.counts,conclusion:'inconclusive: zero evaluated rules, no automated a11y pass'},previewFailures:['snapshot timed out after 15000ms','snapshot timed out after 15000ms']});
const quality=await read(join(out,'quality.json'));sameProductSource(quality.head);for(const key of ['typecheck','unit','biome'])assert.equal(quality[key].exit,0);
assert.match(await readFile(join(out,'unit.txt'),'utf8'),/15 passed/);assert.match(await readFile(join(out,'unit.txt'),'utf8'),/46 passed/);
const doctor=await read(join(out,'doctor.json'));sameProductSource(doctor.sourceRevision);assert.equal(doctor.ok,true);assert.equal(doctor.baseline.newCount,0);
const cleanup=await read(join(out,'cleanup.json'));sameProductSource(cleanup.head);assert.equal(cleanup.ownedContainersRemaining,0);assert.equal(cleanup.ownedPortListenersRemaining,0);assert.equal(cleanup.containersRemoved,3);
const verification={source,modes,matchedPairs:matched,actualInput:before.report,restoredComparisonBytes:true,quality:{typecheckStages:4,suites:15,tests:46,strictBiomeFiles:4,doctorNewDiagnostics:0,doctorScore:'unavailable'},cleanup:{containersRemoved:3,containersRemaining:0,portListenersRemaining:0},limits:['no generated empty-license fixture: Unknown is assembled-only','axe zero evaluated rules: inconclusive','production static generation/remote Tolgee/physical devices/true zoom/provider/exhaustive locales remain root limits'],status:'implementation evidence; issue OPEN; root owns readiness'};
await save('evidence-verification.json',verification);
console.log(JSON.stringify({head:source.head,modes,matchedPairs:matched.length,verified:true}));
