import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

export const repo = resolve(process.cwd());
export const beforeRef = "fe499a787b218523c07b7c904fe04b34700d6f2c";
export const consumerPaths = [
 "apps/webapp/src/components/reports/projects/project-reports-container.tsx",
 "apps/webapp/src/components/reports/projects/report-share-link-list.tsx",
];
const supportingPaths = [
 "apps/webapp/src/lib/navigation/route-metadata.ts",
 "apps/webapp/src/components/reports/projects/report-scope-failure.tsx",
 "apps/webapp/src/components/providers/organization-context-provider.tsx",
 "apps/webapp/src/components/providers/view-refresh-provider.tsx",
 "apps/webapp/src/app/[locale]/(app)/reports/projects/page.tsx",
 "apps/webapp/src/app/[locale]/(app)/reports/projects/share-actions.ts",
 "apps/webapp/src/app/[locale]/(app)/settings/report-share-links/page.tsx",
];
export const requireRoot = createRequire(join(repo, "package.json"));
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = bytes => bytes.toString("utf8").replaceAll("\r\n", "\n");
export async function sourceProof(phase, expectedRef) {
 assert.ok(["before", "after"].includes(phase), "Expected before or after");
 const pinRef = phase === "before" ? beforeRef : expectedRef;
 const source = [];
 for (const path of [...consumerPaths, ...supportingPaths]) {
  let actual;
  try { actual = await readFile(join(repo, path)); }
  catch (error) { if (error.code === "ENOENT" && !consumerPaths.includes(path)) continue; throw error; }
  const entry = { path, bytesSha256: sha(actual), canonicalSha256: sha(canonical(actual)),
   gitBlob: execFileSync("git", ["hash-object", "--path=" + path, path], {cwd: repo, encoding:"utf8", windowsHide:true}).trim() };
  if ((consumerPaths.includes(path)||path==='apps/webapp/src/lib/navigation/route-metadata.ts') && pinRef) {
   const expected = execFileSync("git", ["show", pinRef + ":" + path], {cwd:repo, windowsHide:true});
   entry.expectedRef = pinRef;
   entry.expectedCanonicalSha256 = sha(canonical(expected));
   assert.equal(entry.canonicalSha256, entry.expectedCanonicalSha256, "Consumer source pin mismatch: " + path);
  }
  source.push(entry);
 }
 return { head: execFileSync("git", ["rev-parse", "HEAD"], {cwd:repo, encoding:"utf8", windowsHide:true}).trim(),
  beforeRef, expectedAfterRef: expectedRef ?? null, historicalQualification: "Controlled before changes only the two report consumers and exact heading metadata to fe499a bytes. Current providers, pages and canonical share transports remain recorded independently; not full historical application execution.", source };
}
export async function fixtureFromPointer(pointer) {
 assert.ok(pointer, "Expected fixture pointer pathname");
 const directory = resolve((await readFile(resolve(pointer), "utf8")).trim());
 const read = async name => JSON.parse(await readFile(join(directory, name), "utf8"));
 const runtime = await read("runtime-private.json"), fixture = await read("fixture-private.json"), services = await read("services.json");
 assert.equal(fixture.kind, "disposable");
 assert.equal(new URL(runtime.origin).hostname, "localhost");
 assert.equal(runtime.env.POSTGRES_HOST, "127.0.0.1");
 assert.match(runtime.env.POSTGRES_DB, /^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
 assert.ok(services.label && Array.isArray(services.containers) && services.containers.length);
 for (const container of services.containers) {
  assert.equal(execFileSync("docker", ["inspect", "--format", '{{ index .Config.Labels "z8.agent-owned" }}', container],
   {encoding:"utf8", windowsHide:true}).trim(), services.label, "Owned disposable fixture label");
 }
 return {runtime, fixture};
}
export async function normalSignIn(page, runtime, actor) {
 assert.ok(actor?.email && actor?.password && actor?.organizationId, "Fixture actor incomplete");
 await page.goto(runtime.origin + "/en/sign-in", {waitUntil:"domcontentloaded", timeout:90000});
 const status = await page.evaluate(async actor => {
  const first = await fetch("/api/auth/sign-in/email", {method:"POST", headers:{"content-type":"application/json", "x-captcha-response":"XXXX.DUMMY.TOKEN.XXXX"},
   body:JSON.stringify({email:actor.email,password:actor.password})});
  if (!first.ok) return {signIn:first.status};
  const second = await fetch("/api/auth/organization/set-active", {method:"POST", headers:{"content-type":"application/json"},body:JSON.stringify({organizationId:actor.organizationId})});
  return {signIn:first.status,active:second.status};
 }, actor);
 assert.deepEqual(status, {signIn:200,active:200});
 return status;
}
export async function outputDir(path) { assert.ok(path, "Expected unique output directory"); const out=resolve(path); await mkdir(out,{recursive:true}); return out; }
export const save=(out,name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+"\n");
export const failure=error=>({name:error?.name??"Error",message:error?.message??String(error),stack:error?.stack});
export async function nextMcp(origin) {
 const rpc = async (method,params) => {
  const response = await fetch(origin + "/_next/mcp", {method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},
   body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(30000)});
  assert.ok(response.ok,"Next MCP HTTP failure");
  const raw=await response.text();
  return response.headers.get("content-type")?.includes("text/event-stream")
   ? raw.split(/\r?\n/).filter(line=>line.startsWith("data: ")).map(line=>JSON.parse(line.slice(6))).find(entry=>entry.id===1)
   : JSON.parse(raw);
 };
 const listing=await rpc("tools/list",{}), names=listing.result?.tools?.map(tool=>tool.name)??[];
 const records={available:names,observations:[],qualification:"Recorded while this driver's browser page is alive. Inspect get_page_metadata/get_errors response for its actual connected session; absence is unpassed."};
 for (const name of ["get_page_metadata","get_compilation_issues","get_errors"].filter(name=>names.includes(name))) {
  records.observations.push({name,response:await rpc("tools/call",{name,arguments:{}})});
 }
 return records;
}
