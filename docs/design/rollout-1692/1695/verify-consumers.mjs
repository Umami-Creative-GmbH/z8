// pnpm node docs/design/rollout-1692/1695/verify-consumers.mjs <owned-private-fixture-directory>
// Prepare/authenticate the disposable fixture and start its Next dev server first.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const directory = resolve(process.argv[2]);
const runtime = JSON.parse(
	await readFile(join(directory, "runtime-private.json"), "utf8"),
);
const fixture = JSON.parse(
	await readFile(join(directory, "fixture-private.json"), "utf8"),
);
const auth = JSON.parse(
	await readFile(join(directory, "dev-auth-private.json"), "utf8"),
);
assert.equal(fixture.kind, "disposable");
assert.equal(new URL(runtime.origin).hostname, "localhost");
const output = resolve("docs/design/rollout-1692/1695");
const results = [];
const check = (name, value) => {
	assert.ok(value, name);
	results.push({ name, passed: true });
	console.log("Passed: " + name);
};
const browser = await puppeteer.launch({
	executablePath:
		process.env.Z8_TEST_CHROME_PATH ||
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
});
const context = await browser.createBrowserContext();
await context.setPermission(runtime.origin, {
	permission: { name: "notifications" },
	state: "denied",
});
const actor = async (label) => {
	const cookies = await context.cookies();
	if (cookies.length) await context.deleteCookie(...cookies);
	await context.setCookie(...auth[label].cookies);
};
await actor("small-admin");
let page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const goto = async (path) =>
	page.goto(runtime.origin + path, { waitUntil: "networkidle0" });
const find = async (selector, name) =>
	(
		await page.waitForFunction(
			(selector, name) =>
				[...document.querySelectorAll(selector)].find(
					(element) =>
						element.textContent.trim() === name &&
						element.getBoundingClientRect().width > 0,
				),
			{},
			selector,
			name,
		)
	).asElement();
const button = async (name, scope = "body") => find(`${scope} button`, name);
const click = async (name, scope) => {
	await (await button(name, scope)).focus();
	await page.keyboard.press("Enter");
};
const fill = async (label, value) => {
	const id = await (
		await page.waitForFunction(
			(label) =>
				[
					...document.querySelectorAll(
						"[role=dialog] label,[role=alertdialog] label",
					),
				].find(
					(element) => element.textContent.replace("*", "").trim() === label,
				)?.htmlFor,
			{},
			label,
		)
	).jsonValue();
	assert.ok(id, label + " has a label");
	const field = await page.$(`[id="${id}"]`);
	await field.focus();
	await page.keyboard.down("Control");
	await page.keyboard.press("A");
	await page.keyboard.up("Control");
	await page.keyboard.press("Backspace");
	await field.type(value);
};
const shot = async (name) =>
	page.screenshot({ path: join(output, name + ".png") });
const fits = async () =>
	page.evaluate(() => {
		const dialog = document.querySelector(
			"[role=alertdialog],[data-slot=action-panel-content]",
		);
		const rect = dialog.getBoundingClientRect();
		return (
			rect.left >= 0 &&
			rect.right <= innerWidth + 1 &&
			rect.top >= 0 &&
			rect.bottom <= innerHeight + 1
		);
	});
const openDeletion = async (target = "small-admin") => {
	await goto(
		"/en/calendar/" +
			auth[target].employeeId +
			"?date=" +
			(target === "small-admin"
				? "2025-01-06"
				: process.argv[3] || "2025-01-13"),
	);
	await page.waitForSelector("[data-event-id]");
	const events = await page.$$("[data-event-id]");
	await events[1].focus();
	await page.keyboard.down("Shift");
	await page.keyboard.press("F10");
	await page.keyboard.up("Shift");
	await (await find("[role=menuitem]", "Delete")).focus();
	await page.keyboard.press("Enter");
	await page.waitForSelector("[role=alertdialog] textarea");
};
const pendingFailure = async (confirm, scope) => {
	let held;
	let count = 0;
	await page.setRequestInterception(true);
	const listener = (request) => {
		if (request.method() === "POST" && request.headers()["next-action"]) {
			count++;
			if (!held) {
				held = request;
				return;
			}
		}
		void request.continue();
	};
	page.on("request", listener);
	await click(confirm, scope);
	await page.waitForFunction(
		(scope) => document.querySelector(`${scope} form[aria-busy=true]`),
		{},
		scope,
	);
	check(
		confirm + " disables duplicate submission",
		await (await button(confirm, scope)).evaluate(
			(element) => element.disabled,
		),
	);
	await page.keyboard.press("Escape");
	check(confirm + " keeps pending overlay on Escape", !!(await page.$(scope)));
	await page.evaluate(
		(scope) => document.querySelector(`${scope} form`).requestSubmit(),
		scope,
	);
	check(confirm + " sends one pending action", count === 1);
	await shot(
		scope.includes("alert")
			? "after-deletion-pending"
			: "after-location-pending",
	);
	await held.abort("failed");
	page.off("request", listener);
	await page.setRequestInterception(false);
	await page.waitForSelector(`${scope} [role=alert]`);
};

try {
	await page.setViewport({ width: 1600, height: 1000 });
	await goto("/en/settings/locations");
	await click("Create Location");
	await click("Create Location", "[role=dialog]");
	check(
		"ordinary invalid field is focused",
		await page.evaluate(
			() => document.activeElement?.getAttribute("aria-invalid") === "true",
		),
	);
	const name = "F3 fixture workshop " + crypto.randomUUID().slice(0, 8);
	await fill("Name", name);
	await fill("Street", "Fixture street 1");
	await fill("City", "Berlin");
	await fill("Postal Code", "10115");
	await fill("Country Code", "de");
	await pendingFailure("Create Location", "[role=dialog]");
	check(
		"ordinary failure retains typed values",
		await page.evaluate(
			(name) =>
				[...document.querySelectorAll("[role=dialog] input")].some(
					(input) => input.value === name,
				),
			name,
		),
	);
	await shot("after-location-failure");
	await fill("Country Code", "X");
	check(
		"invalid country was entered",
		await page.$eval("#country", (element) => element.value === "X"),
	);
	await click("Create Location", "[role=dialog]");
	await page.waitForSelector("[role=dialog] [role=alert]");
	check(
		"server validation refusal retains form",
		!!(await page.$("[role=dialog] input")),
	);
	await fill("Country Code", "de");
	await click("Create Location", "[role=dialog]");
	await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
	await page.reload({ waitUntil: "networkidle0" });
	check(
		"created location persists through reload",
		await page.evaluate((name) => document.body.innerText.includes(name), name),
	);
	await (await find("a", name)).asLocator().click();
	await click("Edit");
	await page.waitForSelector("[role=dialog] input");
	check(
		"edit uses authoritative saved name",
		await page.evaluate(
			(name) =>
				[...document.querySelectorAll("[role=dialog] input")].some(
					(input) => input.value === name,
				),
			name,
		),
	);
	await page.locator("[role=dialog] [role=switch]").click();
	await click("Save Changes", "[role=dialog]");
	await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
	await page.reload({ waitUntil: "networkidle0" });
	check(
		"saved inactive status persists",
		await page.evaluate(() => document.body.innerText.includes("Inactive")),
	);
	await click("Edit");
	await fill("Name", name + " draft");
	await click("Cancel", "[role=dialog]");
	await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
	await click("Edit");
	await page.waitForSelector("[role=dialog] input");
	check(
		"ordinary cancellation preserves existing mounted draft lifetime",
		await page.evaluate(
			(name) =>
				[...document.querySelectorAll("[role=dialog] input")].some(
					(input) => input.value === name + " draft",
				),
			name,
		),
	);
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
	await click("Toggle theme");
	await (await find("[role=menuitem]", "Dark")).asLocator().click();
	await page.locator("button[aria-label^='Account:']").click();
	await (await find("[role=menuitem]", "Font size")).hover();
	await (await find("[role=menuitemradio]", "Large")).asLocator().click();
	await page.setViewport({ width: 390, height: 844 });
	await page.reload({ waitUntil: "networkidle0" });
	await click("Edit");
	await page.waitForFunction(
		() =>
			document
				.querySelector("[data-slot=action-panel-content]")
				?.getBoundingClientRect().right <=
			innerWidth + 1,
	);
	check("phone panel fits viewport", await fits());
	check(
		"large preference produces 18px text",
		await page.evaluate(
			() => getComputedStyle(document.documentElement).fontSize === "18px",
		),
	);
	check(
		"saved dark theme is active",
		await page.evaluate(() =>
			document.documentElement.classList.contains("dark"),
		),
	);
	await shot("after-location-phone-large-dark");
	await page.setViewport({ width: 390, height: 500 });
	const scroll = await page.$eval(
		"[data-slot=action-panel-body]",
		(element) => {
			element.scrollTop = element.scrollHeight;
			return {
				scrollHeight: element.scrollHeight,
				clientHeight: element.clientHeight,
				scrollTop: element.scrollTop,
			};
		},
	);
	check(
		"short viewport field body scrolls independently",
		scroll.scrollTop > 0,
	);
	check(
		"phone save remains reachable",
		await (
			await button("Save Changes", "[role=dialog]")
		).isIntersectingViewport(),
	);
	await shot("after-location-short-viewport-large-dark");
	await page.setViewport({ width: 2400, height: 1200 });
	check("wide dark panel fits", await fits());
	await shot("after-location-wide-dark");
	await page.keyboard.press("Escape");
	await page.setViewport({ width: 1600, height: 1000 });
	await openDeletion();
	await click("Delete entry", "[role=alertdialog]");
	check(
		"consequential required reason receives focus",
		await page.evaluate(
			() => document.activeElement?.getAttribute("aria-invalid") === "true",
		),
	);
	check(
		"consequential record evidence remains visible",
		await page.evaluate(
			() =>
				document
					.querySelector("[role=alertdialog]")
					.innerText.includes("09:00") &&
				document.querySelector("[role=alertdialog]").innerText.includes("8h"),
		),
	);
	await fill("Reason for deletion", "F3 disposable fixture audit check");
	await pendingFailure("Delete entry", "[role=alertdialog]");
	check(
		"deletion transport failure retains reason",
		await page.$eval(
			"[role=alertdialog] textarea",
			(element) => element.value === "F3 disposable fixture audit check",
		),
	);
	await actor("small-restricted");
	await click("Delete entry", "[role=alertdialog]");
	await page.waitForFunction(
		() =>
			document
				.querySelector("[role=alertdialog] form")
				?.getAttribute("aria-busy") === "false",
	);
	check(
		"server enforces the target employee permission",
		await page.$eval(
			"[role=alertdialog] [role=alert]",
			(element) =>
				element.textContent ===
				"You can only change time entries of employees you manage",
		),
	);
	check(
		"real permission refusal keeps evidence and input",
		await page.$eval(
			"[role=alertdialog] textarea",
			(element) => element.value === "F3 disposable fixture audit check",
		),
	);
	await shot("after-deletion-permission-refusal");
	await actor("small-admin");
	await page.setViewport({ width: 390, height: 844 });
	check("phone large dark confirmation fits", await fits());
	await shot("after-deletion-phone-large-dark");
	await click("Cancel", "[role=alertdialog]");
	await page.waitForFunction(
		() => !document.querySelector("[role=alertdialog]"),
	);
	await page.setViewport({ width: 1600, height: 1000 });
	await openDeletion();
	check(
		"consequential cancellation discards reason per existing lifetime",
		await page.$eval(
			"[role=alertdialog] textarea",
			(element) => element.value === "",
		),
	);
	await fill("Reason for deletion", "F3 disposable fixture audit check");
	await click("Delete entry", "[role=alertdialog]");
	await page.waitForSelector("[role=alertdialog] [role=alert]");
	check(
		"missing manager remains a truthful refusal",
		await page.$eval(
			"[role=alertdialog] [role=alert]",
			(element) =>
				element.textContent === "No manager assigned to approve time changes",
		),
	);
	await shot("after-deletion-missing-manager");
	await click("Cancel", "[role=alertdialog]");
	await page.waitForFunction(
		() => !document.querySelector("[role=alertdialog]"),
	);
	await actor("small-restricted");
	await page.close();
	page = await context.newPage();
	page.setDefaultTimeout(20000);
	page.on("pageerror", (error) => errors.push(error.message));
	await page.setViewport({ width: 1600, height: 1000 });
	await openDeletion("small-restricted");
	await fill("Reason for deletion", "F3 disposable fixture audit check");
	await click("Delete entry", "[role=alertdialog]");
	await page.waitForFunction(
		() => !document.querySelector("[role=alertdialog]"),
	);
	await page.waitForNetworkIdle();
	check(
		"request awaits approval without hiding recorded work",
		await page.$$eval("[data-event-id]", (elements) => elements.length >= 5),
	);
	await shot("after-deletion-requested-calendar");
	await actor("small-admin");
	await goto("/en/settings/teams");
	await click("Create Team");
	await page.waitForSelector("[role=dialog] [role=combobox]");
	const nestedTrigger = await page.$("[role=dialog] [role=combobox]");
	await nestedTrigger.focus();
	await page.keyboard.press("Enter");
	await page.waitForSelector("[role=listbox]");
	await page.keyboard.press("Escape");
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("role") === "combobox",
	);
	check(
		"nested real Select returns focus to its panel control",
		await page.evaluate(
			() => document.activeElement?.getAttribute("role") === "combobox",
		),
	);
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
	await page.waitForFunction(
		() => document.activeElement?.textContent.trim() === "Create Team",
	);
	check(
		"real panel returns focus to its create action",
		await page.evaluate(
			() => document.activeElement?.textContent.trim() === "Create Team",
		),
	);
	await actor("small-restricted");
	await goto("/en/settings/locations");
	check(
		"restricted actor has no location create control",
		await page.evaluate(
			() =>
				![...document.querySelectorAll("button")].some(
					(element) => element.textContent.trim() === "Create Location",
				),
		),
	);
	check("no uncaught browser errors", errors.length === 0);
	await writeFile(
		join(output, "runtime-assertions.json"),
		JSON.stringify(
			{
				results,
				scroll,
				errors,
				limits: [
					"Phone and large text are browser emulation; no physical mobile keyboard/safe-area certification.",
					"Transport failure aborts a real server-action request without replacing application reads or action results.",
					"Permission refusal uses another real authenticated actor against the already-open admin form.",
				],
			},
			null,
			2,
		),
	);
	console.log(`Passed ${results.length} real-consumer assertions.`);
} catch (error) {
	await page.screenshot({
		path: join(directory, "matrix-failure-private.png"),
	});
	await writeFile(
		join(directory, "matrix-failure-private.json"),
		JSON.stringify(
			{ results, text: await page.evaluate(() => document.body.innerText) },
			null,
			2,
		),
	);
	throw error;
} finally {
	await browser.close();
}
