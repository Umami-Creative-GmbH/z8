// pnpm node docs/design/rollout-1692/1701/verify-actions.mjs <owned-private-fixture>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
const dir = resolve(process.argv[2]),
	out = resolve("docs/design/rollout-1692/1701");
const load = async (f) => JSON.parse(await readFile(join(dir, f), "utf8"));
const runtime = await load("runtime-private.json"),
	fixture = await load("fixture-private.json"),
	auth = await load("dev-auth-private.json");
assert.equal(fixture.kind, "disposable");
assert.equal(new URL(runtime.origin).hostname, "localhost");
const requestDay = Number(process.argv[3] || 7),
	requestNote = `R002 live failure recovery request ${requestDay}`;
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
});
const results = [];
const check = (name, value) => {
	assert.ok(value, name);
	results.push({ name, passed: true });
	writeFileSync(
		join(out, "action-assertions.json"),
		JSON.stringify(
			{
				scope:
					"synthetic small-employee, real failed transport/retry/pending/cancel lifecycle",
				results,
			},
			null,
			2,
		),
	);
	console.log("Passed: " + name);
};
try {
	const context = await browser.createBrowserContext();
	await context.setPermission(runtime.origin, {
		permission: { name: "notifications" },
		state: "denied",
	});
	await context.setCookie(...auth["small-employee"].cookies);
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	await page.setViewport({ width: 1600, height: 1000 });
	await page.goto(runtime.origin + "/en/absences", {
		waitUntil: "networkidle0",
	});
	const find = async (selector, name, contains = false) =>
		(
			await page.waitForFunction(
				(selector, name, contains) =>
					[...document.querySelectorAll(selector)].find(
						(e) =>
							(contains
								? e.textContent.includes(name)
								: e.textContent.trim() === name ||
									e.getAttribute("aria-label") === name) &&
							e.getBoundingClientRect().width,
					),
				{},
				selector,
				name,
				contains,
			)
		).asElement();
	const click = async (name, scope = "body") => {
		const el = await find(scope + " button", name);
		if (name === "Submit Request") {
			await page.waitForFunction(
				() =>
					document.querySelector("[role=dialog] button[type=submit]")
						?.disabled === false,
			);
			await el.focus();
			await page.keyboard.press("Enter");
		} else await el.click();
	};
	const choose = async (label, option) => {
		await click(label, "[role=dialog]");
		try {
			const el = await find("[role=option]", option, true);
			await el.click();
			await page.waitForFunction(
				() =>
					![...document.querySelectorAll("[role=option]")].some(
						(e) => e.getBoundingClientRect().width,
					),
			);
		} catch (error) {
			await writeFile(
				join(dir, "action-options-private.json"),
				JSON.stringify(
					await page.$$eval("[role=option]", (es) =>
						es.map((e) => e.textContent),
					),
				),
			);
			await page.screenshot({ path: join(dir, "action-failed-private.png") });
			throw error;
		}
	};
	const day = async (n) => {
		const el = (
			await page.waitForFunction(
				(n) =>
					[...document.querySelectorAll("h3")]
						.find((e) => e.textContent === "December")
						.parentElement.querySelectorAll("button") &&
					[
						...[...document.querySelectorAll("h3")]
							.find((e) => e.textContent === "December")
							.parentElement.querySelectorAll("button"),
					].find((e) => e.textContent === String(n)),
				{},
				n,
			)
		).asElement();
		await el.focus();
		await page.keyboard.press("Enter");
		await page.waitForSelector("[role=dialog]");
	};
	await day(requestDay);
	await choose("Absence Type *", "R002 Vacation");
	await choose("Deputy", "Person 1");
	const notes = await page.$("[role=dialog] textarea");
	await notes.type(requestNote);
	let failed = false;
	await page.setRequestInterception(true);
	const fail = (req) => {
		if (
			!failed &&
			req.method() === "POST" &&
			req.url().endsWith("/en/absences") &&
			req.postData()?.includes("R002 live failure recovery request")
		) {
			failed = true;
			void req.abort("failed");
		} else void req.continue();
	};
	page.on("request", fail);
	await click("Submit Request", "[role=dialog]");
	try {
		await page.waitForFunction(() =>
			[...document.querySelectorAll("[data-sonner-toast]")].some(
				(e) => e.innerText.includes("Failed") || e.innerText.includes("fetch"),
			),
		);
	} catch (e) {
		await page.screenshot({ path: join(dir, "mutation-failed-private.png") });
		await writeFile(
			join(dir, "mutation-state-private.json"),
			JSON.stringify(await page.$eval("body", (e) => e.innerText)),
		);
		throw e;
	}
	check("real transport failure was injected at the mutation boundary", failed);
	check(
		"failure keeps request input",
		await page.$eval(
			"[role=dialog] textarea",
			(e, note) => e.value === note,
			requestNote,
		),
	);
	await page.screenshot({ path: join(out, "request-failed-retained.png") });
	page.off("request", fail);
	await page.setRequestInterception(false);
	await click("Submit Request", "[role=dialog]");
	await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
	await click("Table");
	const search = await page.$("input[name=search]");
	await search.type(requestNote);
	await page.waitForFunction(
		(note) => document.querySelector("tbody")?.innerText.includes(note),
		{},
		requestNote,
	);
	check(
		"retry persists real personal request and deputy",
		await page.$eval(
			"tbody",
			(e) =>
				e.innerText.includes("Pending") && e.innerText.includes("Person 1"),
		),
	);
	await page.screenshot({ path: join(out, "request-persisted.png") });
	await click("Cancel absence", "tbody");
	await click("Cancel", "[role=alertdialog]");
	await page.waitForFunction(
		() => !document.querySelector("[role=alertdialog]"),
	);
	check(
		"cancel confirmation leaves record",
		await page.$eval("tbody", (e) =>
			e.innerText.includes("R002 live failure recovery request"),
		),
	);
	await click("Cancel absence", "tbody");
	await click("Yes, cancel request", "[role=alertdialog]");
	await page.waitForFunction(() =>
		document.querySelector("tbody")?.innerText.includes("No absences match"),
	);
	check("confirmed cancellation refreshes actual records", true);
	await click("Calendar");
	await day(8);
	await choose("Absence Type *", "R002 Sick leave");
	await choose("Sick detail *", "Without certificate");
	check(
		"sick detail remains available",
		await page.$eval("[role=dialog]", (e) =>
			e.innerText.includes("Without certificate"),
		),
	);
	await page.screenshot({ path: join(out, "sick-note-path.png") });
	await click("Cancel", "[role=dialog]");
	await writeFile(
		join(out, "action-assertions.json"),
		JSON.stringify(
			{
				scope:
					"small-employee, synthetic December 2026 request; real failed transport/retry/pending/cancel lifecycle",
				results,
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
