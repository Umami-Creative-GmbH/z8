import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as mixedProbe from "./mixed-load-probe.mjs";
import { openPublicHeaderClock } from "./public-header-clock.mjs";

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
