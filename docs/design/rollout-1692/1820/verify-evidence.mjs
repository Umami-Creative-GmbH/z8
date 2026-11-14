import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const json=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const before=await json('before-runtime.json'),after=await json('after-runtime.json');
assert.deepEqual(before.errors,[]);assert.deepEqual(after.errors,[]);
assert.equal(Object.keys(before.result).length,9);assert.deepEqual(Object.keys(before.result),Object.keys(after.result));
for(const source of [before,after])for(const [label,state] of Object.entries(source.result)){
 assert.equal(state.width,state.documentWidth,label);assert.deepEqual(state.headings,['Accept invitation']);
 if(['expired','revoked','used','missing'].includes(label)){assert.match(state.text,/Invitation unavailable/);assert.equal(state.buttons.length,0);assert.equal(state.links.length,0);}
 else{assert.match(state.text,/Performance small/);assert.match(state.text,/Person 0/);assert.match(state.text,/member/);assert.match(state.text,/perf-large-2-6f068b73bdef@example.test/);}
}
assert.equal(after.result['phone-signedout'].links.length,2);
assert.equal(after.result['phone-mismatch'].buttons[0].text,'Sign out and switch account');
assert.equal(after.result['desktop-light'].buttons[0].type,'button');
const actions=await json('actions-runtime.json'),brand=await json('branding-runtime.json');assert.deepEqual(actions.errors,[]);assert.deepEqual(brand.errors,[]);
assert.equal(actions.results.acceptance.handoffPath,'/en/init');assert.equal(actions.results.acceptance.membershipVisibleThroughRealRead,true);
console.log('Verified 18 matching before/after state-layout captures, all context/refusal branches, real membership handoff and zero page errors.');
