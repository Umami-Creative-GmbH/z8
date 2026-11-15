import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const json=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const before=await json('before.json'),after=await json('after.json');
assert.equal(before.actor,after.actor);assert.equal(before.route,after.route);
assert.equal(before.observations.length,3);assert.equal(after.observations.length,3);
for(let i=0;i<3;i++){
 const a=after.observations[i],b=before.observations[i];assert.equal(a.name,b.name);assert.equal(a.rows,b.rows);assert.equal(a.rows,2);assert.equal(a.width,a.viewport);assert.equal(b.width,b.viewport);assert.deepEqual(a.headings,['Equipment']);assert.deepEqual(b.headings,['Equipment','Equipment']);assert.equal(a.dark,b.dark);
 for(const phase of ['before','after'])assert.ok((await readFile(new URL(`${phase}-${a.name}.png`,import.meta.url))).subarray(1,4).equals(Buffer.from('PNG')));
}
assert.equal(after.observations.find(n=>n.name==='wide-dark').dark,true);assert.deepEqual(before.errors,[]);assert.deepEqual(after.errors,[]);
const comparison=await json('comparison.json');assert.equal(comparison.restored.length,6);
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
assert.match(comparison.sourceVersion,/^[a-f0-9]{40}$/);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const lf=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
for(const {file,sha256} of comparison.restored){
 const captured=lf(execFileSync('git',['show',`${comparison.sourceVersion}:${file}`],{cwd:repo}));
 const crlf=Buffer.from(captured.toString('utf8').replace(/\n/g,'\r\n'));
 assert.ok([hash(captured),hash(crlf)].includes(sha256),`${file}: retained raw hash must match the captured Git blob with LF or CRLF`);
 if(process.argv.includes('--current-source'))assert.ok(lf(await readFile(resolve(repo,file))).equals(captured),`${file}: current canonical source differs from captured snapshot`);
}
const variants=await json('variants.json');assert.equal(variants.checks.length,11);assert.deepEqual(variants.errors,[]);
const core=await json('runtime.json');assert.equal(core.checks.length,24);assert.equal(core.errors.length,2);assert.ok(core.errors.every(message=>message==="Cannot read properties of null (reading 'textContent')"));
const next=await json('next-runtime.json');assert.deepEqual(next.get_compilation_issues,{issues:[]});assert.deepEqual(next.get_errors,{configErrors:[],sessionErrors:[]});
const native=await json('react-runtime.json');assert.ok(native.components.every(n=>n.present));
console.log(`Verified matched scope/viewport/row/title evidence, retained raw hashes against captured source ${comparison.sourceVersion}${process.argv.includes('--current-source')?' and current canonical source':''}, 24 core + 11 final variant assertions, retained historical messages, native tree and Next diagnostics. This does not constitute a fresh browser run.`);
