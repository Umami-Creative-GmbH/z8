/** Test-only preload for the directly owned collector child; never load into an app. */
import { basename } from "node:path";
if (
	basename(process.argv[1] ?? "") !== "collector.mjs" ||
	!process.send ||
	!process.argv.includes("--require-registration") ||
	process.env.Z8_TEST_PROJECT !== "unit"
)
	throw Error("Owned collector test clock requires the unit child IPC seam.");
const originalNow = Date.now;
const originalInterval = globalThis.setInterval;
let now = originalNow(),
	interval = null,
	executed = 0;
Date.now = () => now;
globalThis.setInterval = function (callback, milliseconds, ...args) {
	const timer = Reflect.apply(originalInterval, this, [
		callback,
		milliseconds,
		...args,
	]);
	if (milliseconds === 60000) {
		if (interval || typeof callback !== "function")
			throw Error("Unexpected collector housekeeping timer.");
		interval = { callback, timer, args, nextAt: now + 60000 };
	}
	return timer; // The actual Timeout and its original unref/clear semantics survive.
};
process.on("message", (message) => {
	if (!message || message.kind !== "owned-collector-test-clock") return;
	const id = message.id,
		amount = message.advanceMs;
	if (
		!Number.isSafeInteger(id) ||
		id < 1 ||
		id > 32 ||
		!Number.isSafeInteger(amount) ||
		amount < 0 ||
		amount > 660000 ||
		!interval
	) {
		process.send?.({
			kind: "owned-collector-test-clock-result",
			id,
			ok: false,
		});
		return;
	}
	const target = now + amount,
		before = executed;
	while (interval.nextAt <= target) {
		now = interval.nextAt;
		interval.nextAt += 60000;
		Reflect.apply(interval.callback, interval.timer, interval.args);
		executed++;
	}
	now = target;
	process.send?.({
		kind: "owned-collector-test-clock-result",
		id,
		ok: true,
		advanceMs: amount,
		actualHousekeepingCallbacks: executed - before,
		totalHousekeepingCallbacks: executed,
		realTimerUnrefed: !interval.timer.hasRef(),
	});
});
