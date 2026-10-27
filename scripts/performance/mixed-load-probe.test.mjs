import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import * as mixedProbe from "./mixed-load-probe.mjs";
import { openPublicHeaderClock } from "./public-header-clock.mjs";
import * as publicHeaderClock from "./public-header-clock.mjs";

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
	const button={getAttribute:key=>key==="aria-label"?dom.label:key==="aria-expanded"?"true":null,getClientRects:()=>dom.visible?[{}]:[],get disabled(){return dom.disabled;},get textContent(){return dom.label;},matches:()=>dom.disabled,closest:selector=>{if(selector==='[data-clock-status]')if(dom.markerReadError)throw Error("PRIVATE_DIAGNOSTIC_READ");return selector==='[data-clock-status="ready"]'?dom.marker==="ready"?{}:null:dom.marker?{getAttribute:()=>dom.marker}:null;}};
	const document={querySelectorAll:()=>[button,...dom.extraButtons]};
	page.goto=page.reload=async()=>page.emit("framenavigated",{parentFrame:()=>null});
	page.evaluate=async(fn,...args)=>runInNewContext('('+fn.toString()+')(...args)',{args,document,AbortSignal:{timeout:()=>({})},fetch:async path=>({ok:true,json:async()=>path.includes("get-session")?{user:{email:expected.email},session:{activeOrganizationId:expected.organizationId}}:{onlineSubmit:"available",submit:"unavailable"}})});
	let predicate,resolveResponse,writes=0;
	page.waitForResponse=match=>{predicate=match;return new Promise(resolve=>{resolveResponse=resolve;});};
	const handle={isVisible:async()=>dom.visible,evaluate:async(fn,...args)=>fn(button,...args),asLocator:()=>({setTimeout:()=>({click:async()=>{
		writes++;const action=dom.label==="Clock In"?"in":"out",request={headers:()=>({}),url:()=>"http://localhost/api/time-clock",method:()=>"POST",postData:()=>JSON.stringify({action:"clock_"+action})};
		const response={request:()=>request,url:()=>request.url(),text:async()=>JSON.stringify({success:dom.responseSuccess,PRIVATE_FIELD:"PRIVATE_VALUE"}),status:()=>200,ok:()=>true};
		page.emit("request",request);page.emit("response",response);dom.label=action==="in"?"Clock Out":"Clock In";dom.afterWrite?.();if(predicate(response))resolveResponse(response);
	}})})};
	page.$$=async()=>[handle];page.waitForFunction=async(fn,...args)=>{assert.equal(await page.evaluate(fn,...args.slice(1)),true);};
	const status=(text,body)=>{const request={headers:()=>({"next-action":"PRIVATE_STATUS_ACTION"}),url:()=>"http://localhost/en",method:()=>"POST"};page.emit("request",request);page.emit("response",{request:()=>request,url:()=>request.url(),text:()=>body??Promise.resolve(text)});return request;};
	return {page,dom,expected,status,writes:()=>writes};
}

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
