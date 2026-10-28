import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import * as fixture from "./fixture.mjs";

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
