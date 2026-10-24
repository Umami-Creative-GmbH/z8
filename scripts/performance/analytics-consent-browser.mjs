/** Parent-owned real browser operator. No SDK replacement, raw capture or invented initialization metrics. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { verifyAnalyticsArtifact } from "./analytics-consent-fixture.mjs";

export async function openAnalyticsConsentBrowser(
	directory,
	{
		authFile,
		actor = "small-admin",
		sdk = "pass",
		executablePath = process.env.Z8_FIXTURE_CHROME ||
			"C:/Program Files/Google/Chrome/Application/chrome.exe",
	} = {},
) {
	// MUST precede even the first browser navigation. A browser allowlist cannot guard Next's server rewrite.
	const { fixture, report } = await verifyAnalyticsArtifact(directory);
	const launch = JSON.parse(
		await readFile(join(directory, "launch-private.json"), "utf8"),
	);
	if (
		launch.origin !== fixture.origin ||
		launch.routesManifestSha256 !== report.routesManifestSha256 ||
		launch.buildIdSha256 !== report.buildIdSha256 ||
		!Number.isInteger(launch.pid)
	)
		throw new Error("Verified operator launch required.");
	process.kill(launch.pid, 0);
	const version = await fetch(new URL("/api/app-version", fixture.origin), {
		signal: AbortSignal.timeout(5000),
		redirect: "error",
	});
	if (
		!version.ok ||
		(await version.json()).buildHash !== report.compiledBuildHash
	)
		throw new Error("Running server does not match verified artifact.");
	for (const [path, hash] of Object.entries(report.tokenChunkHashes)) {
		const response = await fetch(new URL(path, fixture.origin), {
			signal: AbortSignal.timeout(10000),
			redirect: "error",
		});
		if (
			!response.ok ||
			createHash("sha256")
				.update(Buffer.from(await response.arrayBuffer()))
				.digest("hex") !== hash
		)
			throw new Error(
				"Running public configuration differs from compiled variant.",
			);
	}
	const auth = JSON.parse(await readFile(authFile, "utf8"));
	if (!auth[actor]?.cookies)
		throw new Error("Owned synthetic actor authentication required.");
	if (!["pass", "hold", "fail"].includes(sdk))
		throw new Error("Unknown SDK resource mode.");
	const require = createRequire(join(fixture.artifactApp, "package.json"));
	// Any browser-level/background traffic that escapes page interception reaches a rejecting local proxy.
	const browser = await require("puppeteer-core").launch({
		executablePath,
		headless: true,
		args: [
			`--proxy-server=${fixture.sinkOrigin}`,
			"--proxy-bypass-list=localhost;127.0.0.1",
			"--disable-quic",
			"--disable-background-networking",
			"--disable-component-update",
			"--no-first-run",
		],
	});
	try {
		const context = await browser.createBrowserContext();
		await context.setCookie(...auth[actor].cookies);
		await context.setPermission(fixture.origin, {
			permission: { name: "notifications" },
			state: "denied",
		});
		const page = await context.newPage();
		await page.setViewport({ width: 1280, height: 900 });
		await page.emulateTimezone("Europe/Berlin");
		await page.setBypassServiceWorker(true);
		await page.setCacheEnabled(false);
		const cdp = await page.createCDPSession();
		await cdp.send("Network.enable");
		await cdp.send("Performance.enable");
		const counts = {
			requests: 0,
			blockedExternal: 0,
			failedRequests: 0,
			pageErrors: 0,
			sdkAttempts: 0,
			sdkHeld: 0,
			sdkAborted: 0,
			sdkCompleted: 0,
			sdkEncodedBytes: 0,
			encodedBytes: 0,
			ingestAttempts: 0,
		};
		const sdkPaths = new Set(Object.keys(report.sdkChunks));
		const sdkRequests = new Set();
		cdp.on("Network.requestWillBeSent", ({ requestId, request }) => {
			if (sdkPaths.has(new URL(request.url).pathname))
				sdkRequests.add(requestId);
		});
		cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
			counts.encodedBytes += encodedDataLength;
			if (sdkRequests.delete(requestId)) {
				counts.sdkCompleted++;
				counts.sdkEncodedBytes += encodedDataLength;
			}
		});
		cdp.on("Network.loadingFailed", ({ requestId }) => {
			sdkRequests.delete(requestId);
		});
		page.on("pageerror", () => {
			counts.pageErrors++;
		});
		page.on("requestfailed", () => {
			counts.failedRequests++;
		});
		let mode = sdk;
		const held = new Set();
		await page.setRequestInterception(true);
		page.on("request", (request) => {
			counts.requests++;
			const url = new URL(request.url());
			if (url.origin !== fixture.origin) {
				counts.blockedExternal++;
				void request.abort("blockedbyclient").catch(() => {});
				return;
			}
			if (url.pathname.startsWith("/ingest/")) counts.ingestAttempts++;
			if (sdkPaths.has(url.pathname)) {
				counts.sdkAttempts++;
				if (mode === "hold") {
					counts.sdkHeld++;
					held.add(request);
					return;
				}
				if (mode === "fail") {
					counts.sdkAborted++;
					void request.abort("failed").catch(() => {});
					return;
				}
			}
			void request.continue().catch(() => {});
		});
		const baseline = Object.fromEntries(
			(await cdp.send("Performance.getMetrics")).metrics.map(
				({ name, value }) => [name, value],
			),
		);
		return {
			page,
			context,
			fixture,
			report,
			async navigate(path = "/en/settings/profile") {
				if (!path.startsWith("/") || path.startsWith("//"))
					throw new Error("Relative fixture route required.");
				await page.goto(new URL(path, fixture.origin).href, {
					waitUntil: "domcontentloaded",
					timeout: 45000,
				});
			},
			async releaseSdk({ fail = false } = {}) {
				mode = fail ? "fail" : "pass";
				for (const request of held) {
					if (fail) {
						counts.sdkAborted++;
						await request.abort("failed").catch(() => {});
					} else await request.continue().catch(() => {});
					held.delete(request);
				}
			},
			async consent() {
				await page.waitForSelector(
					"#profile-help-improve-product:not([disabled])",
					{ timeout: 45000 },
				);
				return page.$eval(
					"#profile-help-improve-product",
					(element) => element.getAttribute("aria-checked") === "true",
				);
			},
			async saveConsent(enabled) {
				await page.waitForSelector(
					"#profile-help-improve-product:not([disabled])",
					{ timeout: 45000 },
				);
				if (
					(await page.$eval(
						"#profile-help-improve-product",
						(element) => element.getAttribute("aria-checked") === "true",
					)) !== enabled
				)
					await page.locator("#profile-help-improve-product").click();
				const response = page.waitForResponse(
					(response) =>
						response.request().method() === "POST" &&
						Boolean(response.request().headers()["next-action"]),
					{ timeout: 45000 },
				);
				await page
					.locator(
						'form:has(#profile-help-improve-product) button[type="submit"]',
					)
					.click();
				if (!(await response).ok())
					throw new Error(
						"Consent save failed; inspect privately and do not retry blindly.",
					);
				await page.waitForSelector(
					"#profile-help-improve-product:not([disabled])",
					{ timeout: 45000 },
				);
			},
			async snapshot() {
				const metrics = Object.fromEntries(
					(await cdp.send("Performance.getMetrics")).metrics.map(
						({ name, value }) => [name, value],
					),
				);
				const sink = await fetch(
					new URL("/__fixture_metrics", fixture.sinkOrigin),
					{ signal: AbortSignal.timeout(3000), redirect: "error" },
				);
				const sinkCounts = await sink.json();
				const allowed = [
					"config",
					"flags",
					"capture",
					"recording",
					"unexpected",
					"blockedProxy",
					"requestBytes",
					"oversized",
				];
				if (
					!sink.ok ||
					allowed.some(
						(key) => !Number.isFinite(sinkCounts[key]) || sinkCounts[key] < 0,
					)
				)
					throw new Error("Count-only sink unavailable.");
				return {
					...counts,
					scriptDurationMs:
						(metrics.ScriptDuration - baseline.ScriptDuration) * 1000,
					taskDurationMs: (metrics.TaskDuration - baseline.TaskDuration) * 1000,
					layoutDurationMs:
						(metrics.LayoutDuration - baseline.LayoutDuration) * 1000,
					sink: Object.fromEntries(
						allowed.map((key) => [key, sinkCounts[key]]),
					),
				};
			},
			async close() {
				for (const request of held)
					await request.abort("aborted").catch(() => {});
				await context.close();
				await browser.close();
			},
		};
	} catch (error) {
		await browser.close();
		throw error;
	}
}
