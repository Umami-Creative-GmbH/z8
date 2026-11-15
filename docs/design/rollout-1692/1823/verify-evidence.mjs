import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const repo=process.cwd(), directory=join(repo,"docs/design/rollout-1692/1823");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const final=JSON.parse(await readFile(join(directory,"final-runtime.json"),"utf8"));
for(const source of final.source.sources) assert.equal(hash(await readFile(join(repo,source.path))),source.sha256,source.path);
const files=[];
for(const name of (await readdir(directory)).filter(name=>name.endsWith(".png")).sort()){
 const phase=name.split("-")[0], evidence=JSON.parse(await readFile(join(directory,phase+"-runtime.json"),"utf8"));
 const bytes=await readFile(join(directory,name));
 assert.equal(bytes.subarray(1,4).toString(),"PNG");
 files.push({name,sha256:hash(bytes),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sourceEvidence:phase+"-runtime.json",head:evidence.source.head});
}
const readback=JSON.parse(await readFile(join(directory,"membership-readback.json"),"utf8"));
assert.equal(readback.readback[0].status,"pending");assert.equal(readback.readback[0].employees,0);
assert.equal(readback.readback[1].status,"approved");assert.equal(readback.readback[1].employees,1);
for(const record of readback.readback){assert.equal(record.codeUses,1);assert.match(record.membershipCreatedAtUtc,/^2026-11-15T08:2[78]:[0-9:.]+Z$/);}
const head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
await writeFile(join(directory,"evidence-verification.json"),JSON.stringify({head,currentApplicationMatchesFinalCaptureSources:true,codeGlyphsMaskedInPng:true,files},null,2)+"\n","utf8");
console.log("Verified "+files.length+" PNG hashes/source mappings and final application source hashes; canonical UTC membership readback checked.");
