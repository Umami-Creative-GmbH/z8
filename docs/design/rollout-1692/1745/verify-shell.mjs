// pnpm node docs/design/rollout-1692/1745/verify-shell.mjs <owned-fixture> <owned-cdp-file>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
const dir = process.argv[2],
	runtime = JSON.parse(await readFile(dir + "/runtime-private.json")),
	auth = JSON.parse(await readFile(dir + "/dev-auth-private.json"));
const b = await puppeteer.connect({
	browserWSEndpoint: (await readFile(process.argv[3], "utf8")).trim(),
});
const c = await b.createBrowserContext();
await c.setPermission(runtime.origin, {
	permission: { name: "notifications" },
	state: "denied",
});
await c.setCookie(...auth["small-manager"].cookies);
const p = await c.newPage();
for (const old of await b.pages()) if (old !== p) await old.close();
await p.emulateTimezone("Europe/Berlin");
await p.setViewport({ width: 1600, height: 1000 });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(runtime.origin + "/en/time-tracking", {
	waitUntil: "networkidle0",
});
await p.waitForSelector('header button[aria-label="Clock In"]');
const click = async (text) => {
	const e = (
		await p.waitForFunction(
			(t) =>
				[...document.querySelectorAll("button")].find(
					(e) =>
						e.getBoundingClientRect().width &&
						(e.textContent.trim() === t || e.getAttribute("aria-label") === t),
				),
			{},
			text,
		)
	).asElement();
	await e.focus();
	await p.keyboard.press("Enter");
};
const result = {
	errors,
	h1: await p.$$eval("h1", (els) => els.map((e) => e.textContent)),
};
const before = await p.$$eval(
	"table tbody tr",
	(els) => els.filter((e) => e.getBoundingClientRect().width).length,
);
await click("Grouped by day");
const after = await p.$$eval(
	"table tbody tr",
	(els) => els.filter((e) => e.getBoundingClientRect().width).length,
);
assert.equal(after, before);
result.records = { groupedRows: before, allRows: after };
await click("All entries");
await p.keyboard.down("Control");
await p.keyboard.press("B");
await p.keyboard.up("Control");
await p.waitForNetworkIdle();
result.sidebarCookie = await p.evaluate(() =>
	document.cookie.split("; ").find((c) => c.startsWith("sidebar_state=")),
);
await p.reload({ waitUntil: "networkidle0" });
assert.equal(
	await p.evaluate(() =>
		document.cookie.split("; ").find((c) => c.startsWith("sidebar_state=")),
	),
	result.sidebarCookie,
);
result.sidebarPersisted = true;
result.phoneDrawer = {
	outcome: "unverified",
	reason:
		"Two preliminary focused-link Escape probes timed out waiting for dialog removal; subsequent inspection showed no dialog and focus at Toggle Sidebar. No fresh drawer-close pass claimed.",
};
await p.setViewport({ width: 390, height: 844 });
await p.reload({ waitUntil: "networkidle0" });
await p.evaluate(() =>
	[...document.querySelectorAll('[data-slot="card-title"]')]
		.find((e) => e.textContent === "Time Entries")
		?.scrollIntoView(),
);
await p.screenshot({ path: "docs/design/rollout-1692/1745/phone-records.png" });
await p.setViewport({ width: 1600, height: 1000 });
await p.reload({ waitUntil: "networkidle0" });
await writeFile(dir + "/1745-final-target-private.txt", p.target()._targetId);
await writeFile(
	"docs/design/rollout-1692/1745/final-runtime.json",
	JSON.stringify(result, null, 2),
);
await b.disconnect();
console.log(JSON.stringify(result));
