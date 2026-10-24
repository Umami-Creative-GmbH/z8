import assert from "node:assert/strict";
import test from "node:test";

test("representative Chrome preserves native identity with an owned profile and rejecting proxy", async () => {
	const { representativeChromePlan } = await import(
		"./analytics-consent-chrome.mjs"
	);
	const plan = representativeChromePlan({
		profile: "C:/fixture/browser-profiles/owned-test",
		profileRoot: "C:/fixture/browser-profiles",
		port: 50444,
		sinkOrigin: "http://127.0.0.1:50870",
	});
	assert.ok(plan.includes("--remote-debugging-address=127.0.0.1"));
	assert.ok(plan.includes("--remote-debugging-port=50444"));
	assert.ok(plan.includes("--proxy-server=http://127.0.0.1:50870"));
	assert.equal(
		plan.some((arg) =>
			/headless|enable-automation|user-agent|AutomationControlled/.test(arg),
		),
		false,
	);
	assert.throws(() =>
		representativeChromePlan({
			profile: "C:/existing-user-profile",
			profileRoot: "C:/fixture/browser-profiles",
			port: 50444,
			sinkOrigin: "http://127.0.0.1:50870",
		}),
	);
	assert.throws(() =>
		representativeChromePlan({
			profile: "C:/fixture/browser-profiles/owned-test",
			profileRoot: "C:/fixture/browser-profiles",
			port: 0,
			sinkOrigin: "http://127.0.0.1:50870",
		}),
	);
});
