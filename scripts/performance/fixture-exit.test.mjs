import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fixture from "./fixture.mjs";

test("compiled app directory is explicit absolute and start-only without changing default builds", () => {
	assert.equal(typeof fixture.resolveFixtureStartAppDirectory, "function");
	const defaultApp = fileURLToPath(new URL("../../apps/webapp", import.meta.url));
	assert.equal(fixture.resolveFixtureStartAppDirectory([]), defaultApp);
	assert.equal(fixture.resolveFixtureStartAppDirectory(["--build"]), defaultApp);
	const custom = join(defaultApp, "synthetic-compiled-app");
	assert.equal(isAbsolute(custom), true);
	assert.equal(fixture.resolveFixtureStartAppDirectory(["--app-dir", custom]), custom);
	for (const args of [["--app-dir"], ["--app-dir", "relative/app"], ["--app-dir", custom, "--app-dir", custom], ["--app-dir", custom, "--build"], ["--app-dir=" + custom], ["--app-dir", "--collector"]]) {
		assert.throws(() => fixture.resolveFixtureStartAppDirectory(args), /Fixture.*app|Fixture.*compiled/);
	}
});

test("chosen compiled app manifest still rejects stale or missing deployments without env mutation", async () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-explicit-compiled-app-"));
	const next = join(folder, ".next"), manifest = join(next, "required-server-files.json");
	mkdirSync(next);
	const runtime = { env: { NEXT_DEPLOYMENT_ID: "a".repeat(40), NEXT_PUBLIC_BUILD_HASH: "old", DB_POOL_MAX: "1" } }, unchanged = structuredClone(runtime);
	const selected = fixture.resolveFixtureStartAppDirectory(["--app-dir", folder]);
	assert.equal(selected, folder);
	try {
		await assert.rejects(fixture.requireMatchingFixtureDeployment(runtime, join(selected, ".next/required-server-files.json")), /ENOENT/);
		for (const deploymentId of ["b".repeat(40), null, "a".repeat(40)]) {
			writeFileSync(manifest, JSON.stringify({ config: { deploymentId } }));
			if (deploymentId === runtime.env.NEXT_DEPLOYMENT_ID) await assert.doesNotReject(fixture.requireMatchingFixtureDeployment(runtime, manifest));
			else await assert.rejects(fixture.requireMatchingFixtureDeployment(runtime, manifest), /Fixture.*deployment/);
			assert.deepEqual(runtime, unchanged);
		}
		await assert.rejects(fixture.requireMatchingFixtureDeployment({ env: {} }, manifest), /Fixture.*identity/);
	} finally {
		if (existsSync(manifest)) unlinkSync(manifest);
		rmdirSync(next); rmdirSync(folder);
	}
});

test("CLI refuses invalid app overrides before runtime parsing and rejects non-start overrides", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-invalid-app-start-")), runtimeFile = join(folder, "runtime-private.json");
	const fixtureFile = fileURLToPath(new URL("./fixture.mjs", import.meta.url));
	writeFileSync(runtimeFile, "PRIVATE_INVALID_RUNTIME");
	try {
		const start = spawnSync(process.execPath, [fixtureFile, "start", folder, "--app-dir", "relative"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
		assert.equal(start.status, 1); assert.match(start.stderr, /Fixture --app-dir requires/);
		const plan = spawnSync(process.execPath, [fixtureFile, "plan", folder, "--app-dir", folder], { encoding: "utf8", windowsHide: true, timeout: 5000 });
		assert.equal(plan.status, 2); assert.match(plan.stderr, /Usage:/);
		assert.equal(readFileSync(runtimeFile, "utf8"), "PRIVATE_INVALID_RUNTIME");
		assert.equal(existsSync(join(folder, "runtime.log")), false);
	} finally { unlinkSync(runtimeFile); rmdirSync(folder); }
});

test("production exit promise preserves zero/null resolution and original error identity", async () => {
	assert.equal(typeof fixture.waitForProductionFixtureExit, "function");
	for (const code of [0, null]) {
		const child = new EventEmitter();
		const pending = fixture.waitForProductionFixtureExit(child);
		assert.equal(child.listenerCount("exit"), 1);
		assert.equal(child.listenerCount("error"), 1);
		child.emit("exit", code, code === null ? "SIGTERM" : null);
		assert.equal(await pending, undefined);
	}
	const child = new EventEmitter(), original = Error("PRIVATE_ORIGINAL_ERROR");
	const pending = fixture.waitForProductionFixtureExit(child);
	child.emit("error", original);
	await assert.rejects(pending, error => error === original);
});

test("nonzero production exit keeps the actual code signal and UTC observation time", async () => {
	const child = new EventEmitter(), before = Date.now();
	const pending = fixture.waitForProductionFixtureExit(child);
	child.emit("exit", 7, null);
	await assert.rejects(pending, error => {
		const prefix = "Production fixture exited. ";
		assert.ok(error.message.startsWith(prefix));
		const record = JSON.parse(error.message.slice(prefix.length));
		assert.deepEqual(Object.keys(record), ["code", "signal", "observedAtUtc"]);
		assert.equal(record.code, 7);
		assert.equal(record.signal, null);
		assert.equal(new Date(record.observedAtUtc).toISOString(), record.observedAtUtc);
		assert.ok(Date.parse(record.observedAtUtc) >= before && Date.parse(record.observedAtUtc) <= Date.now());
		return true;
	});
});

test("production exit details whitelist primitives without coercion or private values", async () => {
	let reads = 0;
	const hostile = Proxy.revocable({}, { get() { reads++; throw Error("PRIVATE_GETTER"); } });
	hostile.revoke();
	for (const [code, signal, expectedCode, expectedSignal] of [
		[1, "SIGTERM", 1, "SIGTERM"],
		[-1, "SIGSEGV", -1, "SIGSEGV"],
		[Number.MAX_SAFE_INTEGER, "SIGABRT", Number.MAX_SAFE_INTEGER, "SIGABRT"],
		[3221225477, null, 3221225477, null],
		[NaN, undefined, "unknown", "unknown"],
		[Infinity, "PRIVATE_SIGNAL", "unknown", "unknown"],
		["PRIVATE_CODE", hostile.proxy, "unknown", "unknown"],
		[hostile.proxy, { toJSON() { reads++; throw Error("PRIVATE_JSON"); } }, "unknown", "unknown"],
		[undefined, false, "unknown", "unknown"],
	]) {
		const child = new EventEmitter(), pending = fixture.waitForProductionFixtureExit(child);
		child.emit("exit", code, signal);
		await assert.rejects(pending, error => {
			const record = JSON.parse(error.message.slice("Production fixture exited. ".length));
			assert.equal(record.code, expectedCode);
			assert.equal(record.signal, expectedSignal);
			assert.ok(Buffer.byteLength(error.message) < 256);
			assert.doesNotMatch(error.message, /PRIVATE_|stack|cause|command|credential/);
			return true;
		});
	}
	assert.equal(reads, 0);
});

test("production exit listener order and first settlement stay exactly once", async () => {
	for (const first of ["exit", "error"]) {
		const child = new EventEmitter(), order = [], original = Error("PRIVATE_FIRST_ERROR");
		child.on("newListener", name => { if (["exit", "error"].includes(name)) order.push(name); });
		const pending = fixture.waitForProductionFixtureExit(child);
		assert.deepEqual(order, ["exit", "error"]);
		if (first === "exit") {
			child.emit("exit", 7, null);
			child.emit("exit", 9, "SIGTERM");
			child.emit("error", original);
			await assert.rejects(pending, error => JSON.parse(error.message.slice("Production fixture exited. ".length)).code === 7);
		} else {
			child.emit("error", original);
			child.emit("exit", 7, null);
			await assert.rejects(pending, error => error === original);
		}
		assert.equal(child.listenerCount("exit"), 0);
		assert.equal(child.listenerCount("error"), 0);
		assert.deepEqual(order, ["exit", "error"]);
	}
});
