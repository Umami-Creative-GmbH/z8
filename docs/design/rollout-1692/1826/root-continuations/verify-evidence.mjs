import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../../../',import.meta.url));
const json=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonicalHashes=bytes=>{const text=bytes.toString('utf8').replace(/\r\n/g,'\n');return[hash(Buffer.from(text)),hash(Buffer.from(text.replace(/\n/g,'\r\n')))];};
const quality=await json('quality.json'),comparison=await json('comparison-source.json'),before=await json('before.json'),after=await json('after.json');
const baseline=execFileSync('git',['show',comparison.baselineCommit+':'+comparison.path],{cwd:repo});assert.ok(canonicalHashes(baseline).includes(comparison.beforeSha256));
assert.equal(before.cachedInputRestored,false);assert.equal(before.staleInitRequests,0);assert.ok(before.failure); // Not a browser reproduction of cached Activity.
assert.equal(after.failure,undefined);assert.equal(after.cachedInputRestored,false);assert.equal(after.staleInitRequests,0);assert.equal(after.checks.length,7);assert.ok(after.checks.every(x=>x.passed));assert.deepEqual(after.pageErrors,[]);
for(const capture of after.captures){assert.equal(capture.codeFieldRedacted,true);for(const[path,pin]of Object.entries(capture.sources)){const source=execFileSync('git',['show',quality.correctionCommit+':'+path],{cwd:repo});assert.ok(canonicalHashes(source).includes(pin),path);if(process.argv.includes('--current-source'))assert.ok(canonicalHashes(await readFile(new URL('../../../../../'+path,import.meta.url))).includes(pin),path);}}
const red=await json('lifetime-red.json'),social=await json('social-red.json');assert.equal(red.numFailedTests,2);assert.equal(social.numFailedTests,2);
const units=await json('unit-summary.json');assert.equal(units.uniqueFiles,41);assert.equal(units.uniqueCases,257);
const next=await json('next-final.json');assert.deepEqual(next.get_compilation_issues,{issues:[]});assert.deepEqual(next.get_errors,{configErrors:[],sessionErrors:[]});assert.deepEqual(next.pageErrors,[]);assert.equal(next.routes.mfaListed,true);
const signIn=await json('sign-in.json');assert.equal(signIn.stable,true);assert.equal(signIn.emailInput,true);assert.deepEqual(signIn.errors,[]);
const cleanup=await json('cleanup.json');assert.equal(cleanup.portClosed,true);assert.equal(cleanup.remainingOwnedContainers,0);
const sharp=createRequire(new URL('../../../../../apps/webapp/package.json',import.meta.url))('sharp');const pngs=(await readdir(new URL('.',import.meta.url))).filter(x=>x.endsWith('.png'));assert.equal(pngs.length,3);for(const name of pngs){const{info}=await sharp(await readFile(new URL(name,import.meta.url))).raw().toBuffer({resolveWithObject:true});assert.ok(info.width>0&&info.height>0);}
console.log('Verified MFA lifetime/social red cases,41/257 final tests,actual held-success/current-action/invalid-code observations,source pins,three fully decoded captures and cleanup. Cached Activity is assembled-only; this archive check is not a new runtime run.');
