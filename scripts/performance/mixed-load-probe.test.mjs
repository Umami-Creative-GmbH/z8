import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import * as mixedProbe from "./mixed-load-probe.mjs";
import { openPublicHeaderClock } from "./public-header-clock.mjs";
import * as publicHeaderClock from "./public-header-clock.mjs";
import {createHash} from "node:crypto";
import {reviewedLegacyClockFiles,validateLegacyClockReadinessSource,readLegacyClockReadinessSource} from "./legacy-clock-readiness.mjs";
import {legacyClockReadinessAuthority} from "./browser-control-collector.mjs";

test("mixed annual preparation registers the actual response before keyboard selection commits", async () => {
	const events = [],
		keys = [];
	let reads = 0,
		predicate,
		resolveResponse;
	const response = {
		request: () => ({
			headers: () => ({ "next-action": "test-action" }),
			postData: () => '["2025-01-01"]',
		}),
		url: () => "http://localhost/en/analytics/work-hours",
	};
	const trigger = {
		isVisible: async () => true,
		evaluate: async () =>
			++reads === 1
				? true
				: reads === 2
					? { role: "combobox", popup: "listbox", open: "false" }
					: true,
		focus: async () => events.push("focus"),
	};
	const page = {
		$$: async () => [trigger],
		evaluate: async () => ["Last Month", "Current Month", "Last Year"],
		waitForFunction: async () => {},
		waitForResponse: (match) => {
			events.push("registered");
			predicate = match;
			return new Promise((done) => {
				resolveResponse = done;
			});
		},
		keyboard: {
			press: async (key) => {
				keys.push(key);
				if (key === "Enter") {
					assert.equal(events[0], "registered");
					assert.equal(predicate(response), true);
					events.push("committed");
					resolveResponse(response);
				}
			},
		},
	};
	assert.equal(
		await mixedProbe.selectAnnualAnalyticsPeriod(
			page,
			"/en/analytics/work-hours",
		),
		response,
	);
	assert.deepEqual(events, ["registered", "focus", "committed"]);
	assert.equal(keys.filter((key) => key === "Enter").length, 1);
	assert.equal(
		predicate({ ...response, url: () => "http://localhost/en/other" }),
		false,
	);
	assert.equal(
		predicate({
			...response,
			request: () => ({
				headers: () => ({}),
				postData: () => '["2025-01-01"]',
			}),
		}),
		undefined,
	);
});

test("mixed source identity accepts the API seven-character hash only as a prefix of the recorded source", () => {
	const source = "456d28b2da4437662ae8f625a1df6756bff031fe";
	assert.equal(typeof mixedProbe.mixedSourceMatches, "function");
	for (const size of [7, 9, 40])
		assert.equal(
			mixedProbe.mixedSourceMatches(source, source.slice(0, size)),
			true,
		);
	assert.equal(
		mixedProbe.mixedSourceMatches(
			"de0b1a128b384196c7c93ac69cd5324e8d0cbbd8",
			"de0b1a1",
		),
		true,
	);
	assert.equal(
		mixedProbe.mixedSourceMatches(source.slice(0, 9), source.slice(0, 7)),
		true,
	);
});

test("mixed source identity rejects mismatches, malformed hashes and a live hash longer than its pin", () => {
	const source = "456d28b2da4437662ae8f625a1df6756bff031fe";
	assert.equal(typeof mixedProbe.mixedSourceMatches, "function");
	for (const observed of [
		"456d28",
		"456d28b-extra",
		"development",
		"DE0B1A1",
		"de0b1a1",
		`${source}0`,
		null,
		456,
	])
		assert.equal(mixedProbe.mixedSourceMatches(source, observed), false);
	for (const pin of [
		source.slice(0, 7),
		`${source}0`,
		"development",
		null,
		456,
	])
		assert.equal(mixedProbe.mixedSourceMatches(pin, source.slice(0, 7)), false);
	assert.equal(
		mixedProbe.mixedSourceMatches(source.slice(0, 9), source),
		false,
	);
});

const cli = fileURLToPath(new URL("./mixed-load-probe.mjs", import.meta.url));

test("original header observation accepts ninety seconds only with explicit baseline phase", async () => {
	const seen = [];
	const page = { on() {}, off() {}, async goto(_url, options) { seen.push(options.timeout); throw Error("HTTP seam reached"); } };
	const options = { origin: "http://localhost:58792", expectedActor: { email: "fixture@example.test", organizationId: "fixture" }, timeoutMs: 90000 };
	await assert.rejects(openPublicHeaderClock(page, options), /bounded timeout/);
	assert.deepEqual(seen, []);
	await assert.rejects(openPublicHeaderClock(page, { ...options, phase: "baseline" }), /HTTP seam reached/);
	assert.deepEqual(seen, [90000]);
	for (const phase of ["unknown", "toString", "constructor"])
		await assert.rejects(openPublicHeaderClock(page, { ...options, phase }), /bounded timeout/);
});
async function seedPlan(directory, origin = "http://localhost:34123") {
	await writeFile(
		join(directory, "runtime-private.json"),
		JSON.stringify({
			origin,
			env: {
				POSTGRES_DB: "approval_workflow_repository_test_mixed",
				POSTGRES_POOL_MAX: "10",
				POSTGRES_POOL_ACQUISITION_TIMEOUT_MS: "60000",
				POSTGRES_PASSWORD: "never-publish-me",
			},
		}),
	);
	await writeFile(
		join(directory, "fixture-private.json"),
		JSON.stringify({
			kind: "disposable",
			actors: Object.fromEntries(
				["large-admin", "small-admin", "small-manager", "large-manager"].map(
					(name) => [
						name,
						{ employeeId: `private-${name}`, password: "never-publish-me" },
					],
				),
			),
		}),
	);
}

test("single-app mixed plan fixes four distinct users, twenty pairs and bounded annual readers without exposing credentials", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-mixed-plan-"));
	try {
		await seedPlan(directory);
		const result = spawnSync(process.execPath, [cli, "plan", directory, "--phase", "baseline"], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		const plan = JSON.parse(result.stdout);
		assert.equal(plan.version, 2);
		assert.equal(plan.semanticTraceIdentities, 56);
		assert.equal(plan.activeRegistrationLimit, 64);
		assert.equal(plan.retainedIdentityLimit, 10000);
		assert.equal(plan.collectorProtocol, "z8-fixture-otlp-collector-v2");
		assert.equal(plan.traceTransport, "context-loopback-proxy-v1");
		assert.equal(plan.browserPolicy, "isolated-profile-no-prediction-v1");
		assert.equal(plan.clockPairs, 20);
		assert.equal(plan.userConcurrency, 4);
		assert.equal(plan.poolMax, 10);
		assert.equal(plan.poolAcquisitionTimeoutMs, 60000);
		assert.equal(plan.phase, "baseline");
		assert.equal(plan.requestTimeoutMs, 90000);
		assert.equal(plan.analyticsCallers.length, 3);
		assert.equal(plan.analyticsMaxRequestsPerCallerPerCommand, 100);
		assert.equal(result.stdout.includes("never-publish-me"), false);
		assert.equal(result.stdout.includes("private-"), false);
		const optimized = spawnSync(process.execPath, [cli, "plan", directory, "--phase", "release"], { encoding: "utf8" });
		assert.equal(optimized.status, 0, optimized.stderr);
		assert.equal(JSON.parse(optimized.stdout).requestTimeoutMs, 30000);
		for (const args of [[], ["--phase", "unknown"], ["--phase", "baseline", "--phase", "release"]])
			assert.notEqual(spawnSync(process.execPath, [cli, "plan", directory, ...args], { encoding: "utf8" }).status, 0);
	} finally {
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});

test("mixed plan refuses a nonlocal origin while retaining all other valid fixture prerequisites", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-mixed-reject-"));
	try {
		await seedPlan(directory, "https://production.example.test");
		const result = spawnSync(process.execPath, [cli, "plan", directory, "--phase", "baseline"], {
			encoding: "utf8",
		});
		assert.notEqual(result.status, 0);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr.includes("never-publish-me"), false);
	} finally {
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});

test("mixed page locale reaches actual page headers and collector before navigation for every actor",async()=>{
 const actors=["large-admin","small-admin","small-manager","large-manager"];
 for(const actor of actors)for(const locale of ["en","de","fr"]){
  const events=[],context={actor},transport={actor},page={setViewport:async value=>events.push(["viewport",value]),emulateTimezone:async value=>events.push(["timezone",value]),setExtraHTTPHeaders:async value=>events.push(["page-headers",{...value}]),goto:async()=>events.push(["navigate"])};
  const installed={technical:actor};const result=await mixedProbe.installMixedPageObservation({page,context,transport,origin:"http://localhost:58792",condition:{...mixedProbe.mixedBrowserCondition,locale},contextId:actor+"-context",captureContextFailures:true},async options=>{events.push(["install",{...options.headers}]);assert.equal(options.page,page);assert.equal(options.context,context);assert.equal(options.transport,transport);assert.equal(options.contextId,actor+"-context");assert.equal(options.captureContextFailures,true);return installed;});
  assert.equal(result,installed);await page.goto();
  assert.deepEqual(events,[["viewport",{width:1280,height:900}],["timezone","Europe/Berlin"],["page-headers",{"Accept-Language":locale}],["install",{"Accept-Language":locale}],["navigate"]]);
 }
});

test("mixed page locale waits for header setup and fails before installer on unknown locale",async()=>{
 let release,installed=0;const page={setViewport:async()=>{},emulateTimezone:async()=>{},setExtraHTTPHeaders:()=>new Promise(resolve=>{release=resolve;})};
 const running=mixedProbe.installMixedPageObservation({page,condition:mixedProbe.mixedBrowserCondition},async options=>{installed++;assert.deepEqual(options.headers,{"Accept-Language":"en"});});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(installed,0);release();await running;assert.equal(installed,1);
 for(const locale of [undefined,null,"","en\r\nX-Test:bad"]){let calls=0;await assert.rejects(mixedProbe.installMixedPageObservation({page:{setViewport:async()=>{calls++;}},condition:{...mixedProbe.mixedBrowserCondition,locale}},async()=>{calls++;}));assert.equal(calls,0);}
});

function clockDiagnosticPage(){
	const page=new EventEmitter(),dom={label:"Clock In",disabled:false,visible:true,marker:"ready",afterWrite:null,responseSuccess:true,extraButtons:[]},expected={email:"PRIVATE_EMAIL",organizationId:"PRIVATE_ORG"};
	const button={tagName:"BUTTON",checkVisibility:()=>dom.visible,getAttribute:key=>key==="aria-label"?dom.label:key==="aria-expanded"?"true":null,getClientRects:()=>dom.visible?[{}]:[],get disabled(){return dom.disabled;},get textContent(){return dom.label;},matches:()=>dom.disabled,closest:selector=>{if(selector==='[data-clock-status]')if(dom.markerReadError)throw Error("PRIVATE_DIAGNOSTIC_READ");return selector==='[data-clock-status="ready"]'?dom.marker==="ready"?{}:null:dom.marker?{getAttribute:()=>dom.marker}:null;}};
	const document={querySelectorAll:()=>[button,...dom.extraButtons]};
	page.goto=page.reload=async()=>page.emit("framenavigated",{parentFrame:()=>null});
	page.evaluate=async(fn,...args)=>runInNewContext('('+fn.toString()+')(...args)',{args,document,AbortSignal:{timeout:()=>({})},fetch:async path=>({ok:true,json:async()=>path.includes("get-session")?{user:{email:expected.email},session:{activeOrganizationId:expected.organizationId}}:{onlineSubmit:"available",submit:"unavailable"}})});
	let predicate,resolveResponse,writes=0;
	page.waitForResponse=match=>{predicate=match;return new Promise(resolve=>{resolveResponse=resolve;});};
	const handle={isVisible:async()=>dom.visible,evaluate:async(fn,...args)=>fn(button,...args),asLocator:()=>({setTimeout:()=>({click:async()=>{
		writes++;const action=dom.label==="Clock In"?"in":"out",request={headers:()=>({}),url:()=>"http://localhost/api/time-clock",method:()=>"POST",postData:()=>JSON.stringify({action:"clock_"+action})};
		const response={request:()=>request,url:()=>request.url(),text:async()=>JSON.stringify({success:dom.responseSuccess,PRIVATE_FIELD:"PRIVATE_VALUE",...(Object.hasOwn(dom,"serverQueued")?{queued:dom.serverQueued}:{})}),status:()=>200,ok:()=>true};
		page.emit("request",request);page.emit("response",response);dom.label=action==="in"?"Clock Out":"Clock In";dom.afterWrite?.();if(predicate(response))resolveResponse(response);
	}})})};
	page.$$=async()=>[handle];page.waitForFunction=async(fn,...args)=>{assert.equal(await page.evaluate(fn,...args.slice(1)),true);};
	const status=(text,body)=>{const request={headers:()=>({"next-action":"PRIVATE_STATUS_ACTION"}),url:()=>"http://localhost/en",method:()=>"POST"};page.emit("request",request);page.emit("response",{request:()=>request,url:()=>request.url(),text:()=>body??Promise.resolve(text)});return request;};
	return {page,dom,expected,status,writes:()=>writes};
}

function clockActionEvent(page,action,body){
	const request={headers:()=>({"next-action":action}),url:()=>"http://localhost/PRIVATE_ACTION_PATH",method:()=>"POST"};
	page.emit("request",request);
	return {request,respond(){page.emit("response",{request:()=>request,url:()=>request.url(),status:()=>200,text:()=>body});}};
}

test("public clock attempt preserves status delivery when a later unrelated action replaces the latest read",async()=>{
	const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
	try{
		await controls.prepare("in");
		clockActionEvent(f.page,"PRIVATE_STATUS_ACTION",Promise.resolve('{"hasEmployee":true,"isClockedIn":false}')).respond();
		await new Promise(setImmediate);
		clockActionEvent(f.page,"PRIVATE_OTHER_ACTION",Promise.resolve('{"unrelated":"PRIVATE_VALUE"}')).respond();
		await new Promise(setImmediate);
		const d=controls.snapshot();assert.equal(d.lastStatusRead.parseOutcome,"unrecognized");
		assert.equal(d.attemptActionReads.completeness,"known");assert.equal(d.attemptActionReads.records.length,2);
		const [status,other]=d.attemptActionReads.records;
		assert.equal(status.actionHeaderSha256,createHash("sha256").update("PRIVATE_STATUS_ACTION").digest("hex"));
		assert.equal(status.parseOutcome,"status-known");assert.equal(status.isClockedIn,false);assert.equal(status.deliveredToStatusCache,true);assert.equal(status.pending,false);
		assert.equal(other.parseOutcome,"unrecognized");assert.equal(other.deliveredToStatusCache,false);assert.ok(status.completedEventOrdinal<other.requestEventOrdinal);
		assert.equal(status.carryIn,false);assert.equal(status.requestDocumentGeneration,d.documentGeneration);
		assert.equal(await controls.state(),"out");assert.equal(/PRIVATE_|localhost/.test(JSON.stringify(d)),false);
	}finally{controls.dispose();}
});

test("public clock history carries pending reads across prepare and separates no response, failure, OUT and IN",async()=>{
	const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
	try{
		let finish;const carried=clockActionEvent(f.page,"PRIVATE_CARRY_ACTION",new Promise(resolve=>{finish=resolve;}));carried.respond();
		f.page.emit("requestfailed",carried.request);
		const prepared=await controls.prepare("in");
		let d=controls.snapshot();assert.equal(d.attemptActionReads.records.length,1);const original=d.attemptActionReads.records[0];
		assert.equal(original.carryIn,true);assert.equal(original.pending,true);assert.equal(original.failure,"request-failed");assert.ok(original.requestEventOrdinal<d.attempt.prepareEventOrdinal);
		clockActionEvent(f.page,"PRIVATE_NEVER_RESPONDS",Promise.resolve(""));
		const failed=clockActionEvent(f.page,"PRIVATE_FAILED_ACTION",Promise.resolve(""));f.page.emit("requestfailed",failed.request);
		clockActionEvent(f.page,"PRIVATE_OUT_ACTION",Promise.resolve('{"hasEmployee":true,"isClockedIn":false}')).respond();
		clockActionEvent(f.page,"PRIVATE_IN_ACTION",Promise.resolve('{"hasEmployee":true,"isClockedIn":true}')).respond();
		await new Promise(setImmediate);assert.equal(await controls.state(),"out","The existing ready DOM wins even when a status IN was delivered.");
		d=controls.snapshot();const rows=d.attemptActionReads.records;
		assert.equal(rows[1].parseOutcome,"request-pending");assert.equal(rows[1].responseEventOrdinal,null);assert.equal(rows[1].pending,true);
		assert.equal(rows[2].parseOutcome,"request-failed");assert.equal(rows[2].pending,false);assert.ok(rows[2].failedEventOrdinal>rows[2].requestEventOrdinal);
		assert.equal(rows[3].isClockedIn,false);assert.equal(rows[4].isClockedIn,true);assert.equal(rows[4].deliveredToStatusCache,true);
		assert.equal(d.cachedStatus.isClockedIn,true);assert.equal(d.lastDOM.state,"out");
		assert.equal((await prepared.submit()).success,true);await controls.prepare("out");
		const reset=controls.snapshot();assert.equal(reset.attemptActionReads.records.length,2);assert.equal(reset.attemptActionReads.records[0].requestEventOrdinal,original.requestEventOrdinal);assert.equal(reset.attemptActionReads.records[0].attemptPrepareEventOrdinal,reset.attempt.prepareEventOrdinal);assert.equal(reset.attemptActionReads.records[0].requestAttemptPrepareEventOrdinal,null);
		f.page.emit("framenavigated",{parentFrame:()=>null});finish('{"hasEmployee":true,"isClockedIn":false}');await new Promise(setImmediate);
		const completed=controls.snapshot().attemptActionReads.records[0];assert.equal(completed.requestEventOrdinal,original.requestEventOrdinal);assert.equal(completed.requestDocumentGeneration,original.requestDocumentGeneration);assert.ok(completed.completedDocumentGeneration>completed.requestDocumentGeneration);assert.equal(completed.pending,false);assert.equal(completed.failure,"request-failed");
		assert.equal(/PRIVATE_|localhost/.test(JSON.stringify(controls.snapshot())),false);
	}finally{controls.dispose();assert.equal(f.page.listenerCount("requestfailed"),0);}
});

test("public clock attempt history bounds retention and keeps overflow UNKNOWN through reset without extra page calls",async()=>{
	const f=clockDiagnosticPage();let pageCalls=0;const evaluate=f.page.evaluate;f.page.evaluate=(...args)=>{pageCalls++;return evaluate(...args);};
	const controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
	try{
		const prepared=await controls.prepare("in"),before=pageCalls;
		for(let i=0;i<33;i++)clockActionEvent(f.page,"PRIVATE_BOUNDED_ACTION_"+i,Promise.resolve(""));
		assert.equal(pageCalls,before);let h=controls.snapshot().attemptActionReads;
		assert.equal(h.records.length,32);assert.equal(h.retainedBytes,32768);assert.equal(h.overflow,1);assert.equal(h.completeness,"UNKNOWN");assert.ok(Buffer.byteLength(JSON.stringify(h))<=h.byteLimit);
		assert.equal((await prepared.submit()).success,true,"Diagnostic overflow does not change the existing usable-DOM result.");
		await controls.prepare("out");h=controls.snapshot().attemptActionReads;assert.equal(h.records.length,32);assert.equal(h.completeness,"UNKNOWN");assert.equal(h.overflow,1);assert.equal(h.records.every(row=>row.carryIn),true);
		const copy=controls.snapshot();copy.attemptActionReads.records[0].isClockedIn=true;assert.equal(controls.snapshot().attemptActionReads.records[0].isClockedIn,null);
		assert.equal(/PRIVATE_|localhost/.test(JSON.stringify(controls.snapshot())),false);
	}finally{controls.dispose();}
});

test("public clock history exposes failed body reads and rejects unknown action identities without retaining private values",async()=>{
	const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
	try{
		await controls.prepare("in");clockActionEvent(f.page,"PRIVATE_BODY_FAILURE",Promise.reject(Error("PRIVATE_BODY_ERROR"))).respond();await new Promise(setImmediate);
		const row=controls.snapshot().attemptActionReads.records[0];assert.equal(row.parseOutcome,"body-unavailable");assert.equal(row.failure,"body-unavailable");assert.equal(row.pending,false);assert.equal(row.deliveredToStatusCache,false);
		let getterCalls=0;for(const headers of [Object.create({"next-action":"PRIVATE_INHERITED"}),Object.defineProperty({},"next-action",{get(){getterCalls++;throw Error("PRIVATE_GETTER");}}),{"next-action":"x".repeat(1025)}])f.page.emit("request",{headers:()=>headers});
		assert.equal(getterCalls,0);let h=controls.snapshot().attemptActionReads;assert.equal(h.errors,3);assert.equal(h.records.length,1);assert.equal(h.completeness,"UNKNOWN");assert.equal(await controls.state(),"out");
		const missing={headers:()=>({"next-action":"PRIVATE_MISSING_REQUEST"})};f.page.emit("response",{request:()=>missing,url:()=>"http://localhost/PRIVATE",text:async()=>'{"hasEmployee":true,"isClockedIn":true}'});await new Promise(setImmediate);
		h=controls.snapshot().attemptActionReads;assert.equal(h.errors,4);assert.equal(h.records.length,1);assert.equal(h.completeness,"UNKNOWN");assert.equal(controls.snapshot().cachedStatus.isClockedIn,true);assert.equal(await controls.state(),"out");
		assert.equal(/PRIVATE_|localhost|cause|stack/.test(JSON.stringify(controls.snapshot())),false);
	}finally{controls.dispose();}
});

test("public clock request id digest is optional diagnostic metadata with bounded own-data identity",async()=>{
	const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
	try{
		await controls.prepare("in");let getters=0;
		const cases=[{value:"PRIVATE_CDP_ID",known:true},{value:"a".repeat(256),known:true},{value:"",known:false},{value:"a".repeat(257),known:false},{value:null,known:false},{value:123,known:false},{value:"PRIVATE\nID",known:false},{getter:true,known:false},{inherited:true,known:false},{missing:true,known:false}];
		for(const c of cases){const request={headers:()=>({"next-action":"PRIVATE_ACTION"})};if(c.getter)Object.defineProperty(request,"id",{get(){getters++;throw Error("PRIVATE_ID_GETTER");}});else if(c.inherited)Object.setPrototypeOf(request,{id:"PRIVATE_INHERITED_ID"});else if(!c.missing)Object.defineProperty(request,"id",{value:c.value});f.page.emit("request",request);}
		const h=controls.snapshot().attemptActionReads;assert.equal(h.completeness,"known");assert.equal(h.errors,0);assert.equal(h.records.length,cases.length);assert.equal(getters,0);
		for(const [i,c]of cases.entries()){assert.equal(h.records[i].cdpRequestIdIdentity,c.known?"known":"UNKNOWN");assert.equal(h.records[i].cdpRequestIdSha256,c.known?createHash("sha256").update(c.value).digest("hex"):null);}
		const maximum={...h.records[0]};for(const key of ["requestEventOrdinal","requestDocumentGeneration","requestAttemptPrepareEventOrdinal","attemptPrepareEventOrdinal","responseEventOrdinal","responseDocumentGeneration","completedEventOrdinal","completedDocumentGeneration","failedEventOrdinal"])maximum[key]=10000;
		Object.assign(maximum,{httpStatus:599,parseOutcome:"body-unavailable",failure:"body-unavailable",carryIn:false,pending:false,statusReadPending:false,hasEmployee:false,isClockedIn:false,deliveredToStatusCache:false,cdpRequestIdIdentity:"UNKNOWN"});assert.ok(Buffer.byteLength(JSON.stringify(maximum))<=960);
		assert.equal(/PRIVATE_|localhost/.test(JSON.stringify(h)),false);assert.equal(await controls.state(),"out");
	}finally{controls.dispose();}
});

test("public header clock readiness reports the existing usable DOM predicate without changing state",async()=>{
	const {page,dom,expected}=clockDiagnosticPage(),controls=await openPublicHeaderClock(page,{origin:"http://localhost",expectedActor:expected,phase:"baseline",timeoutMs:50});
	try{
		assert.equal(await controls.state(),"out");const diagnostic=controls.snapshot();
		assert.equal(diagnostic.protocol,"public-header-clock-readiness-diagnostic-v1");assert.ok(diagnostic.polls>=2);
		assert.equal(diagnostic.lastDOM.selectedLabel,"clock-in");assert.equal(diagnostic.lastDOM.marker,"ready");assert.equal(diagnostic.lastDOM.state,"out");
		dom.disabled=true;dom.marker="pending";assert.equal(await controls.state(),null);assert.equal(controls.snapshot().lastDOM.enabledVisible,0);assert.equal(controls.snapshot().lastDOM.markers.pending,1);assert.equal(controls.snapshot().lastDOM.clockInVisible,1);
		assert.doesNotMatch(JSON.stringify(controls.snapshot()),/PRIVATE_EMAIL|PRIVATE_ORG|localhost/);
	}finally{controls.dispose();}
});

test("public header clock diagnostics distinguish stale missing and unrecognized status without accepting their DOM",async()=>{
	const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
	try{
		f.dom.marker=null;assert.equal(await controls.state(),null);assert.equal(controls.snapshot().cachedStatus,null);
		f.status('{"hasEmployee":true,"isClockedIn":false,"private":"PRIVATE_STATUS"}');await new Promise(setImmediate);
		assert.equal(await controls.state(),"out");assert.equal(controls.snapshot().cachedStatus.parseOutcome,"status-known");
		assert.equal(controls.snapshot().cachedStatus.actionHeaderSha256Known,true);assert.equal(controls.snapshot().cachedStatus.originMatches,true);assert.ok(controls.snapshot().statusAgeMs>=0);
		f.dom.label="Clock Out";assert.equal(await controls.state(),null);assert.equal(controls.snapshot().lastDOM.selectedLabel,"clock-out");assert.equal(controls.snapshot().cachedStatus.isClockedIn,false);
		f.status('PRIVATE_INVALID_STATUS');await new Promise(setImmediate);assert.equal(controls.snapshot().lastStatusRead.parseOutcome,"unrecognized");assert.equal(await controls.state(),null);
		f.status('',Promise.reject(Error("PRIVATE_READ_ERROR")));await new Promise(setImmediate);assert.equal(controls.snapshot().lastStatusRead.parseOutcome,"body-unavailable");assert.equal(controls.snapshot().pendingStatusReads,0);
		f.dom.marker="ready";assert.equal(await controls.state(),"in","Existing ready marker still suffices despite old cached status.");
		assert.doesNotMatch(JSON.stringify(controls.snapshot()),/PRIVATE_|localhost|\/en/);
	}finally{controls.dispose();}
});

test("public header clock diagnostics expose out-of-order and navigation-stale status while preserving the old predicate",async()=>{
	const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
	try{
		let release;f.status('',new Promise(resolve=>{release=resolve;}));
		f.status('{"hasEmployee":true,"isClockedIn":true}');await new Promise(setImmediate);const newer=controls.snapshot().cachedStatus.requestEventOrdinal;
		f.page.emit("framenavigated",{parentFrame:()=>null});release('{"hasEmployee":true,"isClockedIn":false}');await new Promise(setImmediate);
		const result=controls.snapshot();assert.equal(result.outOfOrderStatusUpdates,1);assert.ok(result.cachedStatus.requestEventOrdinal<newer);assert.equal(result.cachedStatusSameObservedNavigationGeneration,false);
		f.dom.marker=null;assert.equal(await controls.state(),"out","Metadata must not add a new freshness gate.");
		assert.equal(controls.snapshot().actorVerifiedGeneration<controls.snapshot().documentGeneration,true);
	}finally{controls.dispose();}
});

test("public header clock accepted REST acknowledgement remains separate from stale status and failed readiness",async()=>{
	const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:30});
	try{
		f.status('{"hasEmployee":true,"isClockedIn":false}');await new Promise(setImmediate);f.dom.marker=null;
		const prepared=await controls.prepare("in"),result=await prepared.submit();
		assert.equal(result.success,false);assert.equal(result.censored,true);assert.equal(result.httpStatus,200);assert.equal(result.unknownCommandOutcome,false);assert.equal(result.clockReadyMs,null);assert.equal(f.writes(),1);
		const d=result.clockReadinessDiagnostics;assert.equal(d.failureStage,"readiness-deadline");assert.equal(d.writeResponse.accepted,true);assert.equal(d.writeResponse.requestStartedAfterSubmit,true);assert.equal(d.writeResponse.originMatches,true);
		assert.equal(d.cachedStatus.isClockedIn,false);assert.equal(d.statusRequestAfterAcceptedWrite,false);assert.equal(d.lastDOM.selectedLabel,"clock-out");assert.equal(d.lastDOM.marker,"absent");assert.equal(d.lastDOM.enabledVisible,1);assert.equal(d.lastDOM.state,null);
		assert.doesNotMatch(JSON.stringify(d),/PRIVATE_|localhost|clock_in/);await assert.rejects(prepared.submit(),/only once/);
	}finally{controls.dispose();}
});

test("public header clock successful and disabled DOM observations retain their existing outcome and cleanup",async()=>{
	for(const disabled of [false,true]){
		const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:30});
		try{
			f.dom.afterWrite=()=>{f.dom.disabled=disabled;};const result=await (await controls.prepare("in")).submit();
			assert.equal(result.success,!disabled);assert.equal(result.unknownCommandOutcome,false);assert.equal(f.writes(),1);
			const d=result.clockReadinessDiagnostics;assert.equal(d.writeResponse.accepted,true);assert.equal(d.cachedStatus,null);assert.equal(d.lastDOM.enabledVisible,disabled?0:1);
			assert.equal(d.failureStage,disabled?"readiness-deadline":null);assert.equal(d.lastDOM.state,disabled?null:"in");
		}finally{controls.dispose();assert.equal(f.page.listenerCount("request"),0);assert.equal(f.page.listenerCount("response"),0);assert.equal(f.page.listenerCount("framenavigated"),0);}
	}
});

test("public header clock bounded diagnostic counters never change source selection or print raw values",async()=>{
	const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
	try{
		f.dom.extraButtons=Array.from({length:40},()=>({getClientRects:()=>[{}],disabled:false,getAttribute:()=>"Clock Out",closest:()=>null}));
		assert.equal(await controls.state(),"out","Existing first usable button selection is unchanged.");
		const dom=controls.snapshot().lastDOM;assert.equal(dom.candidates,32);assert.equal(dom.truncated,true);assert.equal(dom.enabledVisible,32);assert.equal(dom.conflictingUsableLabels,true);
		const request={headers:()=>({}),url:()=>"http://localhost/PRIVATE_URL"};for(let n=0;n<10002;n++)f.page.emit("request",request);
		const d=controls.snapshot();assert.ok(d.errors>0);assert.ok(d.overflow>0);assert.ok(d.eventOrdinal<=10000);assert.ok(d.requestFacts<=10000);assert.equal(await controls.state(),"out");
		assert.doesNotMatch(JSON.stringify(controls.snapshot()),/PRIVATE_|localhost/);
	}finally{controls.dispose();}
});

test("public header clock HTTP200 with a refused result does not become an accepted-write fact",async()=>{
	const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:30});
	try{
		f.dom.responseSuccess=false;const result=await (await controls.prepare("in")).submit();
		assert.equal(result.success,false);assert.equal(result.httpStatus,200);assert.equal(result.unknownCommandOutcome,false);assert.equal(result.clockReadyMs,null);assert.equal(f.writes(),1);
		assert.equal(result.clockReadinessDiagnostics.failureStage,"caller-result");assert.equal(result.clockReadinessDiagnostics.writeResponse.accepted,false);assert.equal(result.clockReadinessDiagnostics.writeResponse.success,false);assert.equal(result.clockReadinessDiagnostics.writeMatchesCurrentAttempt,true);
	}finally{controls.dispose();}
});

test("public clock queued metadata describes only the existing parsed server response and never changes success",async()=>{
	for(const fixture of [{present:false,type:"absent",value:null},{present:true,type:"boolean",input:true,value:true},{present:true,type:"boolean",input:false,value:false},{present:true,type:"null",input:null,value:null},{present:true,type:"other",input:"PRIVATE_QUEUED",value:null},{present:true,type:"other",input:{private:"PRIVATE_NESTED"},value:null}]){
		const f=clockDiagnosticPage();if(fixture.present)f.dom.serverQueued=fixture.input;
		const controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
		try{const result=await(await controls.prepare("in")).submit(),write=result.clockReadinessDiagnostics.writeResponse;assert.equal(result.success,true);assert.equal(result.unknownCommandOutcome,false);assert.equal(f.writes(),1);assert.equal(write.accepted,true);assert.equal(write.serverQueuedFieldPresent,fixture.present);assert.equal(write.serverQueuedFieldType,fixture.type);assert.equal(write.serverQueued,fixture.value);assert.equal(/PRIVATE_|localhost/.test(JSON.stringify(result.clockReadinessDiagnostics)),false);}finally{controls.dispose();}
	}
});

test("public header clock diagnostic-only read failures cannot change a ready marker decision",async()=>{
	const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
	try{
		f.dom.markerReadError=true;assert.equal(await controls.state(),"out");const d=controls.snapshot();
		assert.equal(d.errors,1);assert.equal(d.lastDOM.known,false);assert.equal(d.lastDOM.reason,"diagnostic-read-unavailable");assert.equal(d.lastDOM.state,"out");assert.doesNotMatch(JSON.stringify(d),/PRIVATE_/);
	}finally{controls.dispose();}
});

test("public header clock initial failure preserves its original identity and exposes only cloned fixed diagnostics",async()=>{
	const f=clockDiagnosticPage();f.dom.marker=null;let caught;
	try{await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:30});}catch(error){caught=error;}
	assert.ok(caught instanceof Error);const diagnostic=publicHeaderClock.getPublicHeaderClockFailureDiagnostics(caught);
	assert.equal(diagnostic.protocol,"public-header-clock-readiness-diagnostic-v1");assert.equal(diagnostic.failureStage,"readiness-deadline");assert.ok(diagnostic.polls>0);assert.equal(diagnostic.lastDOM.state,null);assert.equal(diagnostic.lastDOM.marker,"absent");
	diagnostic.polls=999999;assert.notEqual(publicHeaderClock.getPublicHeaderClockFailureDiagnostics(caught).polls,999999);
	for(const name of ["request","response","framenavigated"])assert.equal(f.page.listenerCount(name),0);
	for(const thrown of [Error("PRIVATE_ORIGINAL_ERROR"),"PRIVATE_NON_ERROR",null]){
		const x=clockDiagnosticPage();x.page.goto=async()=>{throw thrown;};let actual;try{await openPublicHeaderClock(x.page,{origin:"http://localhost",expectedActor:x.expected,phase:"baseline",timeoutMs:30});}catch(error){actual=error;}
		assert.equal(actual,thrown);const details=publicHeaderClock.getPublicHeaderClockFailureDiagnostics(actual);if(thrown instanceof Error){assert.equal(details.polls,0);assert.doesNotMatch(JSON.stringify(details),/PRIVATE_|Error|stack/);}else assert.equal(details,null);
	}
	for(const unknown of [undefined,false,123,"PRIVATE",{},Error("PRIVATE_UNRECORDED")])assert.equal(publicHeaderClock.getPublicHeaderClockFailureDiagnostics(unknown),null);
});

// Registered by the existing performance:test:mixed command; no package change.
{
const sha=value=>createHash('sha256').update(value).digest('hex');
function facts(){const compiledBuild='b'.repeat(40),manifestSha256='a'.repeat(64),origin='http://localhost:58792',phase='baseline',buildRecordSha256='c'.repeat(64);const files=reviewedLegacyClockFiles.map(row=>({...row,physicalSha256:row.canonicalSha256}));return{configuration:{protocol:'source-qualified-legacy-header-readiness-v1',compiledBuild,compiledManifestSha256:manifestSha256,originSha256:sha(origin),phase,review:{path:'C:/private/review.json',sha256:'d'.repeat(64)},buildRecord:{path:'C:/private/build.json',sha256:buildRecordSha256}},review:{schema:1,kind:'root-reviewed-legacy-header-readiness-source-v1',accepted:true,compiledBuild,compiledManifestSha256:manifestSha256,sourceCommit:compiledBuild,originSha256:sha(origin),phase,buildRecordSha256,files},buildRecord:{source:compiledBuild,ci:true,exitCode:0,buildId:'actual-next-build',startedAt:'2026-10-27T00:00:00.000Z',finishedAt:'2026-10-27T00:01:00.000Z'},buildId:'actual-next-build',manifestSha256,compiledBuild,origin,phase,sourceFacts:structuredClone(files)};}
test('reviewed closure joins actual CI source/manifest/origin and survives unrelated future source commits',()=>{const f=facts();assert.equal(validateLegacyClockReadinessSource(f).compiledBuild,f.compiledBuild);const future=facts();future.compiledBuild='e'.repeat(40);future.configuration.compiledBuild=future.compiledBuild;future.review.compiledBuild=future.compiledBuild;future.review.sourceCommit=future.compiledBuild;future.buildRecord.source=future.compiledBuild;assert.equal(validateLegacyClockReadinessSource(future).compiledBuild,future.compiledBuild);});
test('missing/rejected/mismatched authority never qualifies a lookalike closure',()=>{const mutate=[f=>f.review.accepted=false,f=>f.review.accepted='true',f=>delete f.review.sourceCommit,f=>f.review.sourceCommit='f'.repeat(40),f=>f.buildRecord.source='f'.repeat(40),f=>f.buildRecord.ci=false,f=>f.buildRecord.exitCode=1,f=>f.buildRecord.buildId='foreign',f=>f.buildRecord.finishedAt='invalid',f=>f.configuration.compiledBuild='f'.repeat(40),f=>f.manifestSha256='e'.repeat(64),f=>f.origin='http://localhost:1',f=>f.phase='release',f=>f.sourceFacts[0].canonicalSha256='e'.repeat(64),f=>f.sourceFacts[0].gitBlob='f'.repeat(40),f=>f.sourceFacts[0].physicalSha256='f'.repeat(64),f=>f.review.files.reverse(),f=>f.sourceFacts.push(f.sourceFacts[0]),f=>f.review.files[0].extra=true];for(const change of mutate){const f=facts();change(f);assert.throws(()=>validateLegacyClockReadinessSource(f));}});
test('private source assertion failures expose no sentinel values or nested cause',()=>{const f=facts(),sentinel='PRIVATE_CLOCK_SOURCE_SENTINEL';f.review.sourceCommit=sentinel;assert.throws(()=>validateLegacyClockReadinessSource(f),error=>{assert.equal(error.message,'Legacy clock readiness source qualification failed.');assert.equal(error.cause,undefined);assert.doesNotMatch(String(error.stack)+JSON.stringify(error),new RegExp(sentinel));return true;});});
test('private source acquisition sanitizes malformed JSON and filesystem paths',async()=>{const directory=await mkdtemp(join(tmpdir(),'PRIVATE_CLOCK_PATH_SENTINEL-'));try{for(const malformed of ['review','buildRecord']){const f=facts(),privateBytes=Buffer.from('{"PRIVATE_CLOCK_JSON_SENTINEL":'),validBytes=Buffer.from('{}');for(const field of ['review','buildRecord']){const bytes=field===malformed?privateBytes:validBytes,path=join(directory,field+'.json');await writeFile(path,bytes);f.configuration[field]={path,sha256:sha(bytes)};}await assert.rejects(readLegacyClockReadinessSource({...f,manifestPath:join(directory,'missing/.next/required-server-files.json')}),error=>{assert.equal(error.message,'Legacy clock readiness source qualification failed.');assert.equal(error.cause,undefined);assert.doesNotMatch(String(error.stack)+JSON.stringify(error),/PRIVATE_CLOCK_JSON_SENTINEL|PRIVATE_CLOCK_PATH_SENTINEL/);return true;});}const f=facts();f.configuration.review.path=join(directory,'missing.json');await assert.rejects(readLegacyClockReadinessSource({...f,manifestPath:join(directory,'missing/.next/required-server-files.json')}),error=>{assert.equal(error.message,'Legacy clock readiness source qualification failed.');assert.doesNotMatch(String(error.stack)+JSON.stringify(error),/PRIVATE_CLOCK_PATH_SENTINEL/);assert.equal(error.cause,undefined);return true;});}finally{assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\'));await rm(directory,{recursive:true,force:true});}});
}

// Registered by the existing performance:test:mixed command; no package change.
{
const clock=publicHeaderClock;
function node(label='Clock Out',{visible=true,disabled=false,marker=null,tagName='BUTTON'}={}){return{tagName,disabled,matches:()=>disabled,checkVisibility:()=>visible,getClientRects:()=>visible?[{}]:[],getAttribute:key=>key==='aria-label'?label:null,closest:selector=>selector==='[data-clock-status="ready"]'?marker==='ready'?{}:null:marker?{getAttribute:()=>marker}:null};}
function observe(nodes,known,qualified){return runInNewContext('('+clock.readPublicHeaderClockDOM.toString()+')(known,qualified)',{document:{querySelectorAll:()=>nodes},known,qualified});}
test('source-qualified unique legacy DOM can settle despite stale status; old proofs remain unchanged',()=>{assert.equal(observe([node()],{hasEmployee:true,isClockedIn:false},true).value,'in');assert.equal(observe([node('Clock In')],{hasEmployee:true,isClockedIn:true},true).value,'out');assert.equal(observe([node()],null,false).value,null);assert.equal(observe([node()],{hasEmployee:true,isClockedIn:true},false).value,'in');assert.equal(observe([node('Clock In',{marker:'ready'})],null,false).value,'out');});
test('the new branch refuses incomplete/ambiguous/pending/non-native DOM without breaking old positives',()=>{const bad=[[node('Clock Out',{disabled:true})],[node('Clock Out',{visible:false})],[node(),node()],[node(),node('Clock In')],[node(),node('Clock In',{disabled:true})],Array.from({length:33},()=>node()),[node('Clock Out',{marker:'pending'})],[node('Clock Out',{marker:'unavailable'})],[node('Clock Out',{marker:'other'})],[node('Clock Out',{tagName:'DIV'})]];for(const nodes of bad)assert.equal(observe(nodes,null,true).value,null);for(const nodes of [[node()],[node('Clock In')]])assert.equal(observe(nodes,null,false).value,null);assert.equal(observe([node('Clock Out',{marker:'pending'})],{hasEmployee:true,isClockedIn:true},true).value,'in','Existing matching status path is preserved, not a new pending-marker permission.');});
test('NEW legacy authority cannot override CSS-hidden, aria-disabled or effective disabled controls',()=>{for(const mutate of [b=>b.checkVisibility=()=>false,b=>delete b.checkVisibility,b=>b.matches=()=>true,b=>{const get=b.getAttribute;b.getAttribute=key=>key==='aria-disabled'?'true':get(key)}]){const b=node();mutate(b);assert.equal(observe([b],null,true).value,null);}const qualified=observe([node()],null,true);assert.equal(qualified.dom.readinessAuthority,'qualified-legacy-dom');const old=observe([node('Clock In',{marker:'ready'})],null,false);assert.equal(old.dom.readinessAuthority,'existing-marker-or-status');});
}

test('unbranded/copy/raw legacy metadata never supplies direct clock authority',()=>{for(const binding of [undefined,null,false,{},Object.freeze({manifestVerified:true,browserVerified:true,compiledBuild:'b'.repeat(40),legacyClockReadiness:{qualified:true}})])assert.equal(legacyClockReadinessAuthority(binding,{origin:'http://localhost',phase:'baseline'}),null);});
test('all four protocol closures include every newly imported legacy source byte',async()=>{const{primaryProtocolIdentity,companionProtocolIdentity,budgetProtocolIdentity,mixedProtocolIdentity}=await import('./protocol-fingerprints.mjs');const maps=await Promise.all([primaryProtocolIdentity(),companionProtocolIdentity(),budgetProtocolIdentity(),mixedProtocolIdentity()]);assert.deepEqual(maps.map(map=>Object.keys(map).length),[22,28,30,19]);for(const map of maps){assert.match(map['legacy-clock-readiness.mjs'],/^[a-f0-9]{64}$/);assert.match(map['mixed-technical-gzip.mjs'],/^[a-f0-9]{64}$/);}assert.equal(new Set(maps.map(map=>map['legacy-clock-readiness.mjs'])).size,1);});
test("manual team dispatch arms before exactly one existing evaluate and records completion", async () => {
 const {dispatchMixedAnalyticsRequest}=await import("./mixed-load-probe.mjs");
 const order=[],handle={},before=performance.now();let actual,deadline;
 const observation={armTeamReplay(input){order.push("arm");assert.equal(input.traceId,"a".repeat(32));assert.equal(input.url,"http://127.0.0.1:4000/en/team");deadline=input.observerDeadlineMs;return handle;},teamReplayHeaders(value){assert.equal(value,handle);order.push("headers");return {"x-z8-fixture-replay-id":"b".repeat(32)};},finishTeamReplay(value,{error}){assert.equal(value,handle);order.push(error?"failed":"finished");return true;}};
 const page={async evaluate(_callback,input){order.push("evaluate");actual=input;return {status:200,text:"synthetic"};}};
 const captured={path:"/en/team",body:"[]",headers:{"next-action":"c".repeat(40),"accept-language":"en"}};
 assert.deepEqual(await dispatchMixedAnalyticsRequest({page,captured,readerKind:"team",requestId:"a".repeat(32),timeoutMs:90000,observation,origin:"http://127.0.0.1:4000"}),{status:200,text:"synthetic"});
 assert.deepEqual(order,["arm","headers","evaluate","finished"]);
 assert.ok(deadline>=before+90000 && deadline<=performance.now()+90000,'observer deadline is anchored before the same evaluate using its unchanged timeout');
 assert.equal(actual.body,captured.body);assert.equal(actual.timeoutMs,90000);assert.equal(actual.headers["accept-language"],"en");assert.equal(actual.headers["x-z8-fixture-replay-id"],"b".repeat(32));
 assert.equal(Object.hasOwn(captured.headers,"x-z8-fixture-replay-id"),false);
});
test("manual team dispatch never sends when ownership is missing and preserves failures", async () => {
 const {dispatchMixedAnalyticsRequest}=await import("./mixed-load-probe.mjs");let calls=0,finished=null;
 const input={page:{async evaluate(){calls++;throw Error("PRIVATE_PAGE_SENTINEL");}},captured:{path:"/team",body:"[]",headers:{"next-action":"c".repeat(40)}},readerKind:"team",requestId:"a".repeat(32),timeoutMs:30000,origin:"http://127.0.0.1:4000"};
 await assert.rejects(dispatchMixedAnalyticsRequest({...input,observation:{armTeamReplay(){return null;}}}),{message:"Mixed analytics dispatch is unavailable."});assert.equal(calls,0);
 const handle={};await assert.rejects(dispatchMixedAnalyticsRequest({...input,observation:{armTeamReplay(){return handle;},teamReplayHeaders(){return {"x-z8-fixture-replay-id":"b".repeat(32)};},finishTeamReplay(value,facts){assert.equal(value,handle);finished=facts;return true;}}}),{message:"Mixed analytics dispatch is unavailable."});
 assert.equal(calls,1);assert.deepEqual(finished,{error:true});
});

test('mixed capture diagnostic keeps bounded scalar stages and preserves thrown errors without private values',async()=>{
 const ledger=mixedProbe.createMixedCaptureDiagnostics(),d=ledger.begin({actor:'small-admin',kind:'team'});
 assert.deepEqual(ledger.snapshot().rows[0],{actor:'small-admin',reader:'team',stage:'open-page',status:null,responseOK:null,captured:null,bodyRead:'not-reached',bodyReadSource:null,payloadShape:null,success:null,summary:{employees:null,hours:null,weeks:null,overtimeHours:null,correct:null},exceptionName:null});
 d.stage('read-annual-body');d.status({status:()=>200});d.captured({body:'PRIVATE_BODY'});const error=Object.assign(new Error('PRIVATE_MESSAGE'),{name:'ProtocolError',cause:'PRIVATE_CAUSE'});d.failed(error);
 const row=ledger.snapshot().rows[0];assert.equal(row.bodyRead,'rejected');assert.equal(row.exceptionName,'ProtocolError');assert.equal(row.status,200);assert.equal(row.captured,true);assert.doesNotMatch(JSON.stringify(ledger.snapshot()),/PRIVATE_/);
 const summary={employees:8,hours:16704,private:'PRIVATE_SUMMARY'};assert.equal(d.summary(summary),summary);assert.equal(d.responseOK(false),false);d.payload({success:true,private:'PRIVATE_PAYLOAD'});
 assert.equal(ledger.snapshot().rows[0].summary.correct,null);assert.equal(ledger.snapshot().rows[0].success,true);
 ledger.begin({actor:'large-admin',kind:'work'});ledger.begin({actor:'small-manager',kind:'overtime'});ledger.begin({actor:'small-admin',kind:'team'});assert.equal(ledger.snapshot().rows.length,3);assert.equal(ledger.snapshot().overflow,1);
 assert.doesNotMatch(JSON.stringify(ledger.snapshot()),/PRIVATE_/);
});

test('actual mixed capture preserves await order predicates and original failures while identifying the failing stage',async()=>{
 const source=await readFile(new URL('./mixed-load-probe.mjs',import.meta.url),'utf8');
 const capture=source.slice(source.indexOf('async function captureAnalytics('),source.indexOf('\nfunction clockCohorts('));
 const publicResult=source.slice(source.indexOf('function publicResult('),source.indexOf('\nfunction numericMetrics('));
 const summary=source.slice(source.indexOf('function analyticsSummary('),source.indexOf('\n/** One existing manual request'));
 for(const kind of ['good','text-error','golden-error','parse-null','summary-error','http-error','capture-missing']){
  const calls=[],ledger=mixedProbe.createMixedCaptureDiagnostics(),reader={kind:'work',actor:'large-admin',path:'/en/analytics/work-hours'};
  const original=Object.assign(new Error('PRIVATE_RESPONSE_FAILURE'),{name:'ProtocolError'});let listener;
  const page={on(name,value){assert.equal(name,'request');calls.push('listen');listener=value;},async goto(){calls.push('goto');if(kind!=='capture-missing')listener({url:()=> 'http://localhost'+reader.path,headers:()=>({'next-action':'PRIVATE_ACTION_ID'}),postData:()=> '["2025-01-01","PRIVATE_ARGUMENT"]',method:()=> 'POST'});}};
  const payload=kind==='parse-null'?'0:{"a":{"success":true}}\n':JSON.stringify({success:true,data:kind==='summary-error'?null:{byEmployee:Array.from({length:200},()=>({})),summary:{totalHours:kind==='golden-error'?1:417600}}});
  const response={status(){calls.push('status');return kind==='http-error'?500:200;},ok(){calls.push('ok');return kind!=='http-error';},async text(){calls.push('text');if(kind==='text-error')throw original;return payload;}};
  const fn=runInNewContext(publicResult+'\n'+summary+'\n('+capture+')',{URL,openPage:async()=>{calls.push('open');return {page};},verifyActor:async()=>{calls.push('actor');},selectAnnualAnalyticsPeriod:async()=>{calls.push('annual');return response;}});
  const promise=fn({}, {},'http://localhost',reader,{}, {},[],90000,{}, {},ledger);
  if(kind==='good')assert.equal((await promise).reader,reader);
  else await assert.rejects(promise,error=>kind==='text-error'?error===original:true);
  const row=ledger.snapshot().rows[0];assert.equal(row.captured,kind!=='capture-missing');assert.equal(row.status,kind==='http-error'?500:200);
  assert.deepEqual(calls,kind==='text-error'?['open','listen','goto','actor','annual','status','text']:['open','listen','goto','actor','annual','status','text','ok']);
  assert.equal(row.stage,kind==='good'?'complete':kind==='text-error'?'read-annual-body':['http-error','capture-missing'].includes(kind)?'verify-capture':'summarize-annual');
  assert.equal(row.bodyRead,kind==='text-error'?'rejected':'fulfilled');
  assert.equal(row.summary.hours,kind==='good'?417600:kind==='golden-error'?1:null);
  assert.equal(row.exceptionName,kind==='good'?null:kind==='text-error'?'ProtocolError':kind==='summary-error'?'TypeError':'Error');
  assert.doesNotMatch(JSON.stringify(ledger.snapshot()),/PRIVATE_|2025-01/);
 }
});

test('TEAM capture pre-arms the same response and consumes only proxy golden scalars without calling text',async()=>{
	const source=await readFile(new URL('./mixed-load-probe.mjs',import.meta.url),'utf8'),capture=source.slice(source.indexOf('async function captureAnalytics('),source.indexOf('\nfunction clockCohorts('));
	for(const kind of ['good','golden-error','projection-error']){
		const calls=[],ledger=mixedProbe.createMixedCaptureDiagnostics(),reader={kind:'team',actor:'small-admin',path:'/en/analytics/team-performance'},handle={};let listener;
		const page={on(name,value){assert.equal(name,'request');listener=value;},async goto(){calls.push('goto');listener({url:()=> 'http://localhost'+reader.path,headers:()=>({'next-action':'PRIVATE_ACTION'}),postData:()=> '["2025-01-01","PRIVATE_ARGUMENT"]',method:()=> 'POST'});}};
		const response={status:()=>200,ok:()=>true,text(){throw Error('TEAM text must not be called');}};
		const observation={armAnnualTeam(input){calls.push('arm');assert.equal(input.timeoutMs,90000);assert.equal(input.path,reader.path);return handle;},async readAnnualTeam(actualHandle,actualResponse){calls.push('proxy-golden');assert.equal(actualHandle,handle);assert.equal(actualResponse,response);if(kind==='projection-error')throw Error('fixed observer failure');return {projection:{employees:8,hours:kind==='golden-error'?1:16704}};}};
		const fn=runInNewContext('('+capture+')',{URL,openPage:async()=>({page,browserObservation:observation}),verifyActor:async()=>calls.push('actor'),selectAnnualAnalyticsPeriod:async()=>{calls.push('annual');return response;},teamAnnualSummary:mixedProbe.teamAnnualSummary});
		const promise=fn({}, {},'http://localhost',reader,{}, {},[],90000,{}, {},ledger);
		if(kind==='good')assert.equal((await promise).reader,reader);else await assert.rejects(promise);
		assert.deepEqual(calls,['goto','actor','arm','annual','proxy-golden']);
		const row=ledger.snapshot().rows[0];assert.equal(row.bodyReadSource,'proxy-golden');assert.equal(row.payloadShape,null);assert.equal(row.success,null);assert.equal(row.bodyRead,kind==='projection-error'?'rejected':'fulfilled');assert.equal(row.summary.correct,kind==='projection-error'?null:kind==='good');assert.doesNotMatch(JSON.stringify(row),/PRIVATE_/);
	}
});

test('capture diagnostics never publish malformed values or manufacture missing numeric zero',()=>{
 const ledger=mixedProbe.createMixedCaptureDiagnostics(),d=ledger.begin({actor:'large-admin',kind:'work'}),bad=Object.freeze({get employees(){throw Error('PRIVATE_GETTER');}});
 d.status({status:()=>NaN});d.payload({success:'PRIVATE_SUCCESS'});assert.equal(d.summary(bad),bad);d.failed({get name(){throw Error('PRIVATE_NAME');}});
 const row=ledger.snapshot().rows[0];assert.equal(row.status,null);assert.equal(row.summary.employees,null);assert.equal(row.summary.hours,null);assert.equal(row.success,'wrong-type');assert.equal(row.exceptionName,'other');assert.doesNotMatch(JSON.stringify(row),/PRIVATE_/);
 ledger.begin({get actor(){throw Error('PRIVATE_ACTOR');}});assert.equal(ledger.snapshot().overflow,1);assert.equal(ledger.snapshot().rows.length,1);
 ledger.begin({actor:'large-admin',kind:'work'});assert.equal(ledger.snapshot().overflow,2,'a duplicate reader rejects before the row cap');
 ledger.begin({actor:'PRIVATE_ACTOR',kind:'PRIVATE_READER'});assert.equal(ledger.snapshot().overflow,3);assert.equal(ledger.snapshot().rows.length,1);
 for(const status of [-1,600,NaN,Infinity,null,'PRIVATE_STATUS']){d.status({status:()=>status});assert.equal(ledger.snapshot().rows[0].status,null);}
 d.status({status(){throw Error('PRIVATE_STATUS_ERROR');}});d.failed({name:'PRIVATE_ERROR',message:'PRIVATE_MESSAGE'});assert.equal(ledger.snapshot().rows[0].exceptionName,'other');assert.doesNotMatch(JSON.stringify(ledger.snapshot()),/PRIVATE_/);
});

test('capture diagnostic scalar getters are read once and cannot change from numeric or boolean to private text',()=>{
 const ledger=mixedProbe.createMixedCaptureDiagnostics(),d=ledger.begin({actor:'small-admin',kind:'team'});let numeric=0,success=0,correct=0;
 d.summary({get hours(){return ++numeric===1?16704:'PRIVATE_SECOND_READ';},get correct(){return ++correct===1?true:'PRIVATE_SECOND_READ';}});
 d.payload({get success(){return ++success===1?true:'PRIVATE_SECOND_READ';}});
 assert.equal(numeric,1);assert.equal(correct,1);assert.equal(success,1);assert.doesNotMatch(JSON.stringify(ledger.snapshot()),/PRIVATE_/);
});

function clockGetEvent(page,{method="GET",requestURL="http://localhost/api/time-clock/status",responseURL=requestURL,status=200,contentType="application/json",responseHeaders,redirects=[],value={hasEmployee:true,employeeId:"PRIVATE_EMPLOYEE",isClockedIn:false,activeWorkPeriod:null},text,body}={}){
 let reads=0;const request={id:"PRIVATE_GET_ID",headers:()=>({}),url:()=>requestURL,method:()=>method,redirectChain:()=>redirects};
 page.emit("request",request);return {request,reads:()=>reads,respond(){page.emit("response",{request:()=>request,url:()=>responseURL,status:()=>status,headers:()=>responseHeaders??({"content-type":contentType}),text:()=>{reads++;return body??Promise.resolve(text??JSON.stringify(value));}});}};
}

test("public clock observes the exact passive GET DTO through the existing status and DOM predicate",async()=>{
 const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
 try{
  await controls.prepare("in");f.dom.marker=null;assert.equal(await controls.state(),null);
  const event=clockGetEvent(f.page);event.respond();await new Promise(setImmediate);
  assert.equal(await controls.state(),"out");assert.equal(event.reads(),1);
  const d=controls.snapshot(),row=d.attemptActionReads.records[0];assert.equal(d.cachedStatus.source,"page-response-clock-status-get");assert.equal(d.cachedStatus.actionHeaderSha256,null);assert.equal(d.cachedStatus.actionHeaderSha256Known,false);
  assert.equal(row.source,"page-response-clock-status-get");assert.equal(row.actionHeaderSha256,null);assert.equal(row.deliveredToStatusCache,true);assert.equal(d.attemptActionReads.completeness,"known");assert.equal(/PRIVATE_|localhost|employeeId/.test(JSON.stringify(d)),false);
  f.dom.disabled=true;assert.equal(await controls.state(),null,"GET status cannot bypass a disabled DOM.");f.dom.disabled=false;
  f.dom.label="Clock Out";assert.equal(await controls.state(),null,"GET status cannot bypass a mismatching DOM.");
 }finally{controls.dispose();}
});


test("public clock passive GET rejects foreign selectors and ineligible HTTP before reading a body",async()=>{
 const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
 try{
  f.dom.marker=null;
  for(const options of [{method:"POST"},{method:"HEAD"},{requestURL:"http://localhost/api/time-clock"},{requestURL:"http://localhost/api/time-clock/status?"},{requestURL:"http://localhost/api/time-clock/status?x=1"},{requestURL:"http://localhost/api/time-clock/status#x"},{requestURL:"http://foreign.test/api/time-clock/status"},{requestURL:"http://user:pass@localhost/api/time-clock/status"},{responseURL:"http://foreign.test/api/time-clock/status"},{responseURL:"http://localhost/api/time-clock/status?x=1"},{redirects:[{}]},{status:201},{status:401},{status:500},{contentType:"text/html"},{contentType:"application/jsonp"},{contentType:null},{responseHeaders:{}},{responseHeaders:{"content-type":"application/json","Content-Type":"application/json"}},{responseHeaders:Object.defineProperty({},"content-type",{enumerable:true,get(){throw Error("PRIVATE_HEADER_GETTER");}})}]){
   const event=clockGetEvent(f.page,options);event.respond();await new Promise(setImmediate);
   assert.equal(event.reads(),0);assert.equal(await controls.state(),null);assert.equal(controls.snapshot().cachedStatus,null);
  }
  assert.equal(/foreign|pass|localhost/.test(JSON.stringify(controls.snapshot())),false);
 }finally{controls.dispose();}
});

test("public clock passive GET validates every DTO field without retaining business values",async()=>{
 const f=clockDiagnosticPage(),controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
 const valid={hasEmployee:true,employeeId:"PRIVATE_EMPLOYEE",isClockedIn:true,activeWorkPeriod:{id:"PRIVATE_PERIOD",startTime:"2026-10-28T10:00:00.000Z",currentTask:{id:"PRIVATE_TASK",name:"PRIVATE_NAME",state:"open",projectId:"PRIVATE_PROJECT"},breakStartedAt:"2026-10-28T11:00:00.000Z",breakStartedZone:"PRIVATE_ZONE"}};
 try{
  f.dom.marker=null;f.dom.label="Clock Out";
  const invalid=[null,[],{}, {...valid,extra:true},{...valid,employeeId:""},{...valid,hasEmployee:"true"},{...valid,isClockedIn:1},{...valid,isClockedIn:false},{...valid,activeWorkPeriod:null},{...valid,hasEmployee:false},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,extra:true}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,id:""}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,startTime:"2026-10-28T10:00:00Z"}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,startTime:"invalid"}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,breakStartedAt:0}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,breakStartedZone:0}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,currentTask:{...valid.activeWorkPeriod.currentTask,state:"other"}}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,currentTask:{...valid.activeWorkPeriod.currentTask,projectId:null}}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,currentTask:{...valid.activeWorkPeriod.currentTask,name:1}}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,currentTask:{...valid.activeWorkPeriod.currentTask,id:""}}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,currentTask:{...valid.activeWorkPeriod.currentTask,extra:true}}}];
  for(const value of invalid){clockGetEvent(f.page,{value}).respond();await new Promise(setImmediate);assert.equal(await controls.state(),null);assert.equal(controls.snapshot().cachedStatus,null);}
  for(const text of ['PRIVATE_INVALID_JSON','0:{"hasEmployee":true,"isClockedIn":true}',JSON.stringify(valid)+' '.repeat(4194304)]){clockGetEvent(f.page,{text}).respond();await new Promise(setImmediate);assert.equal(controls.snapshot().cachedStatus,null);}
  for(const value of [valid,{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,currentTask:{...valid.activeWorkPeriod.currentTask,state:"done"},breakStartedAt:null,breakStartedZone:null}},{...valid,activeWorkPeriod:{...valid.activeWorkPeriod,currentTask:null}}]){clockGetEvent(f.page,{value,contentType:"Application/JSON; charset=utf-8"}).respond();await new Promise(setImmediate);assert.equal(await controls.state(),"in");}
  clockGetEvent(f.page,{value:{hasEmployee:false,employeeId:null,isClockedIn:false,activeWorkPeriod:null}}).respond();await new Promise(setImmediate);assert.equal(await controls.state(),null);assert.equal(controls.snapshot().cachedStatus.hasEmployee,false);
  assert.equal(/PRIVATE_|employeeId|startTime|projectId|localhost/.test(JSON.stringify(controls.snapshot())),false);
 }finally{controls.dispose();}
});

test("public clock GET and Next action history share the original row budget and preserve lifecycle without Page calls",async()=>{
 const f=clockDiagnosticPage();let calls=0;const evaluate=f.page.evaluate;f.page.evaluate=(...args)=>{calls++;return evaluate(...args);};
 const controls=await openPublicHeaderClock(f.page,{origin:"http://localhost",expectedActor:f.expected,phase:"baseline",timeoutMs:50});
 try{
  await controls.prepare("in");const before=calls;
  const pending=clockGetEvent(f.page);const failed=clockGetEvent(f.page,{body:Promise.reject(Error("PRIVATE_BODY_ERROR"))});failed.respond();await new Promise(setImmediate);
  assert.equal(calls,before);let h=controls.snapshot().attemptActionReads;assert.equal(h.records[0].pending,true);assert.equal(h.records[1].failure,"body-unavailable");
  for(let i=0;i<30;i++)if(i%2)clockActionEvent(f.page,"PRIVATE_ACTION_"+i,Promise.resolve(""));else clockGetEvent(f.page);
  clockGetEvent(f.page);h=controls.snapshot().attemptActionReads;
  assert.equal(h.records.length,32);assert.equal(h.retainedBytes,32768);assert.equal(h.overflow,1);assert.equal(h.completeness,"UNKNOWN");assert.equal(calls,before);
  const max={...h.records[0]};for(const key of ["requestEventOrdinal","requestDocumentGeneration","requestAttemptPrepareEventOrdinal","attemptPrepareEventOrdinal","responseEventOrdinal","responseDocumentGeneration","completedEventOrdinal","completedDocumentGeneration","failedEventOrdinal"])max[key]=10000;
  Object.assign(max,{httpStatus:599,parseOutcome:"response-ineligible",failure:"body-unavailable",carryIn:false,pending:false,statusReadPending:false,hasEmployee:false,isClockedIn:false,deliveredToStatusCache:false});
  assert.ok(Buffer.byteLength(JSON.stringify(max))<=960);assert.ok(Buffer.byteLength(JSON.stringify(h))<=32768);
  pending.respond();await new Promise(setImmediate);assert.equal(controls.snapshot().attemptActionReads.records[0].deliveredToStatusCache,true);assert.equal(controls.snapshot().attemptActionReads.completeness,"UNKNOWN");
  assert.equal(/PRIVATE_|localhost/.test(JSON.stringify(controls.snapshot())),false);
 }finally{controls.dispose();}
});
