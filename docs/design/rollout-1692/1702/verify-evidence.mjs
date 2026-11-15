// Offline artifact assertions; no fixture, secrets, server or browser required.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const load=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
for(const mode of ['before','after']){
 const r=await load(`${mode}-runtime.json`);assert.deepEqual(r.errors,[]);assert.equal(r.checks.length,3);
 for(const c of r.checks){assert.equal(c.width,c.documentWidth);assert.equal(c.h1.length,mode==='before'?2:1);assert.ok(c.main.includes('2025'));assert.match(c.main,/Total Employees\s+8\s/);assert.ok(c.main.includes('2088.0h'));assert.match(c.main,/Total Absence Days\s+416\s/);assert.ok(c.main.includes('0.0%'));
  const png=await readFile(new URL(`${mode}-${c.name}.png`,import.meta.url));assert.equal(png.readUInt32BE(16),c.width);
 }
}
const actions=await load('actions-runtime.json');assert.deepEqual(actions.errors,[]);
const exports=actions.observations.filter(x=>x.export);assert.equal(exports.length,2);for(const e of exports){assert.equal(e.status,200);assert.deepEqual(e.teams.map(x=>x.totalHours),[8352,8352]);assert.deepEqual(e.teams.map(x=>x.employeeCount),[4,4]);}
assert.ok((await readFile(new URL('actual-team-export.csv',import.meta.url),'utf8')).includes('Fixture team 0'));
assert.equal((await readFile(new URL('actual-team-export.xlsx',import.meta.url))).subarray(0,2).toString(),'PK');
assert.equal(actions.observations.find(x=>x.savedDarkLarge).savedDarkLarge.font,'18px');
assert.deepEqual(actions.observations.find(x=>x.roles).roles.map(x=>x.restricted),[false,true,true]);
const b=await load('boundaries-runtime.json');assert.deepEqual(b.errors,[]);assert.equal(b.organizationSwitch.destination.stale,false);assert.ok(b.organizationSwitch.destination.headings.includes('Access Restricted'));assert.equal(b.noEmployee.path,'/en/sign-in');
for(const entry of await load('next-final-runtime.json')){const result=JSON.parse(entry.result.result.content[0].text);if(entry.name==='get_compilation_issues')assert.deepEqual(result.issues,[]);else{assert.deepEqual(result.configErrors,[]);assert.deepEqual(result.sessionErrors,[]);}}
assert.deepEqual((await load('a11y-runtime.json')).violations,[]);
assert.ok((await load('react-runtime.json')).selectedTree.some(x=>x.includes('DataTableToolbar')));
console.log('Verified matching scope/metrics, six captures, real exports, roles, preferences, security boundaries and final runtime diagnostics. Accessibility incompletes remain explicit.');
