// pnpm node docs/design/rollout-1692/1708/verify-evidence.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const load=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const runtime=await load('runtime-assertions.json'),next=await load('next-runtime.json'),react=await load('react-runtime.json');
assert.deepEqual(runtime.before.h1,['Approvals']);assert.equal(runtime.before.rows.length,3);
assert.deepEqual(runtime.states.map(s=>s.rows),[0,1,1]);
assert.ok(runtime.states[0].text.includes('Nobody decided approvals for you during this absence.'));
assert.ok(runtime.states[1].text.includes('Nov 9'));assert.ok(!runtime.states[2].text.includes('Nov 9'));
for(const role of runtime.roles){assert.equal(role.auth.login,200);assert.equal(role.auth.active,200);assert.deepEqual(role.h1,['Page not found']);assert.equal(role.rows,0);assert.equal(role.hasPrivateText,false);}
assert.equal(runtime.loading.rows,0);assert.equal(runtime.loading.returnLink,true);
assert.equal(runtime.outage.rows,0);assert.equal(runtime.recovered.rows,3);
assert.equal(runtime.inFlightOrganizationSwitch.rows,0);assert.equal(runtime.inFlightOrganizationSwitch.privateText,false);
assert.deepEqual(runtime.persistedPreferences.times,['Nov 10, 2026, 3:07 PM','Nov 10, 2026, 4:07 PM','Nov 10, 2026, 5:07 PM']);
assert.equal(runtime.acceptedFinalRowReachability.documentWidth,390);assert.ok(runtime.acceptedFinalRowReachability.lastBottom<=runtime.acceptedFinalRowReachability.viewport);
assert.equal(runtime.postMergeRead.rows,3);assert.equal(runtime.postMergeRead.h1Count,1);
assert.deepEqual(next.compilation,{issues:[]});assert.deepEqual(next.errors,{configErrors:[],sessionErrors:[]});assert.equal(next.includesR010,true);
assert.equal(react.treeSucceeded,true);assert.equal(react.inspectSucceeded,true);assert.ok(react.inspect.includes('mobileLayout: "stacked"'));
for(const capture of await load('capture-dimensions.json')){const dimensions=[];for(const mode of ['before','after']){const bytes=await readFile(new URL(`${mode}-${capture.name}.png`,import.meta.url));dimensions.push({width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});}assert.deepEqual(dimensions[0],dimensions[1]);assert.deepEqual(dimensions[0],capture.before);}
console.log('R010 artifact assertions and all four matched capture dimensions passed.');
