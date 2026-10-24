/** Explicit real-fixture acceptance check; absence of its configured runtime fails, never skips. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

test("synthetic actors authenticate through Better Auth and retain usable production clock controls", {
	timeout: 240000,
}, async () => {
	const directory = process.env.Z8_PERFORMANCE_RUNTIME_DIRECTORY;
	const executablePath = process.env.Z8_TEST_CHROME_PATH;
	assert.ok(
		directory && executablePath,
		"Configure the disposable runtime directory and Chrome path; runtime acceptance is unfulfilled without them.",
	);
	const fixture = fileURLToPath(new URL("./fixture.mjs", import.meta.url));
	const result = await new Promise((done) =>
		execFile(
			process.execPath,
			[fixture, "authenticate", directory],
			{ timeout: 180000 },
			(error, stdout) => done({ code: error?.code ?? 0, stdout }),
		),
	);
	assert.equal(
		result.code,
		0,
		"The real synthetic authentication command must succeed.",
	);
	assert.match(result.stdout, /8 synthetic actors/);
	const runtime = JSON.parse(
		await readFile(join(directory, "runtime-private.json"), "utf8"),
	);
	const auth = JSON.parse(
		await readFile(join(directory, "auth-private.json"), "utf8"),
	);
	assert.equal(Object.keys(auth).length, 8);
	assert.equal(
		Object.values(auth).every((actor) =>
			actor.cookies
				.filter((cookie) => /^__(Secure|Host)-/.test(cookie.name))
				.every((cookie) => cookie.secure),
		),
		true,
		"Secure production cookie attributes must survive the fixture driver.",
	);
	const browser = await puppeteer.launch({ executablePath, headless: true });
	try {
		for (const actor of Object.values(auth)) {
			const context = await browser.createBrowserContext();
			try {
				await context.setCookie(...actor.cookies);
				const page = await context.newPage();
				await page.goto(new URL("/en", runtime.origin).href, {
					waitUntil: "domcontentloaded",
					timeout: 45000,
				});
				await page.waitForSelector(
					'button[aria-label="Clock In"]:not(:disabled)',
					{ visible: true, timeout: 45000 },
				);
				assert.equal(
					new URL(page.url()).pathname,
					"/en",
					"Authenticated fixture stays on the Dashboard.",
				);
			} finally {
				await context.close();
			}
		}
	} finally {
		await browser.close();
	}
});
