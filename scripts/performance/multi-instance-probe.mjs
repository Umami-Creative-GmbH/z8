/** Real UI-captured Server Actions; raw cookies/requests/results stay in memory. */
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readMultiInstanceFixture } from "./multi-instance-fixture.mjs";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const trace = () => randomBytes(16).toString("hex");
const traceparent = (id) => `00-${id}-${randomBytes(8).toString("hex")}-01`;

export async function openMultiInstanceAnalytics(
	directory,
	{ kind = "team", actor = "large-admin", replica = "a" } = {},
) {
	directory = resolve(directory);
	const fixture = await readMultiInstanceFixture(directory);
	const auth = JSON.parse(
		await readFile(join(directory, "auth-private.json"), "utf8"),
	);
	const control = JSON.parse(
		await readFile(join(directory, "collector-control.json"), "utf8"),
	);
	const require = createRequire(join(fixture.artifactApp, "package.json"));
	const puppeteer = require("puppeteer-core");
	if (!["a", "b"].includes(replica))
		throw new Error("Choose a real fixture replica.");
	const pathname = `/en/analytics/${{ team: "team-performance", work: "work-hours", overtime: "overtime-burn-down" }[kind]}`;
	const browser = await puppeteer.launch({
		executablePath:
			process.env.Z8_FIXTURE_CHROME ||
			"C:/Program Files/Google/Chrome/Application/chrome.exe",
		headless: true,
	});
	const context = await browser.createBrowserContext();
	await context.setCookie(...auth[actor].cookies);
	const permissions = await browser.target().createCDPSession();
	await permissions.send("Browser.setPermission", {
		permission: { name: "notifications" },
		setting: "denied",
		origin: fixture.origin,
		browserContextId: context.id,
	});
	const page = await context.newPage();
	await page.setViewport({ width: 1280, height: 900 });
	await page.emulateTimezone("Europe/Berlin");
	let captured;
	await page.setRequestInterception(true);
	page.on("request", (request) => {
		const headers = { ...request.headers() };
		if (new URL(request.url()).origin === fixture.origin) {
			headers["x-z8-fixture-replica"] ||= replica;
			const body = request.postData();
			if (
				headers["next-action"] &&
				body?.includes("2025-01-01") &&
				new URL(request.url()).pathname === pathname
			)
				captured = {
					pathname,
					body,
					headers: Object.fromEntries(
						["next-action", "next-router-state-tree", "content-type", "accept"]
							.filter((key) => headers[key])
							.map((key) => [key, headers[key]]),
					),
				};
		}
		request.continue({ headers }).catch(() => {});
	});
	async function metrics(id, allowCacheError) {
		let previous;
		let stable = 0;
		for (let attempt = 0; attempt < 20; attempt++) {
			await pause(250);
			const rows = await (
				await fetch(new URL("/metrics", control.endpoint))
			).json();
			const row = rows.find((item) => item.traceId === id);
			const signature = JSON.stringify(row);
			stable = signature === previous ? stable + 1 : 0;
			previous = signature;
			if (
				stable >= 2 &&
				row?.coverage &&
				["observer", "pg", "rows", "eventLoop"].every(
					(key) => row.coverage[key] === true,
				) &&
				(row.coverage.cache === true || allowCacheError) &&
				row.coverage.rejectedBatches === 0 &&
				Number.isFinite(row.poolWaitMs)
			)
				return {
					traceId: id,
					queries: row.queryCount,
					rows: row.rowsRetrieved,
					hits: row.cacheHits,
					misses: row.cacheMisses,
					queryDurationMs: row.queryDurationMs,
					poolAcquisitionMs: row.poolWaitMs,
					eventLoopDelayMs: row.eventLoopDelayMs,
					coverage: row.coverage,
				};
		}
		throw new Error("Complete real telemetry not observed.");
	}
	try {
		await page.goto(fixture.origin + pathname, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForSelector('button[aria-label="Period"]:not([disabled])', {
			timeout: 45000,
		});
		const response = page.waitForResponse(
			(value) =>
				value.request().headers()["next-action"] &&
				value.request().postData()?.includes("2025-01-01") &&
				new URL(value.url()).pathname === pathname,
			{ timeout: 60000 },
		);
		response.catch(() => {});
		await page.click('button[aria-label="Period"]');
		await page.waitForSelector('[role="option"]');
		let selected = false;
		for (const option of await page.$$('[role="option"]'))
			if (
				await option.evaluate(
					(element) => element.textContent.trim() === "Last Year",
				)
			) {
				await option.click();
				selected = true;
				break;
			}
		if (!selected || !(await response).ok() || !captured)
			throw new Error("Actual annual UI request unavailable.");
		async function replay(
			target,
			{ concurrency = 1, cookies, onResponse } = {},
		) {
			if (
				!["a", "b"].includes(target) ||
				!Number.isInteger(concurrency) ||
				concurrency < 1 ||
				concurrency > 16
			)
				throw new Error("Invalid bounded replica request.");
			if (cookies) {
				await context.deleteCookie(...(await context.cookies()));
				await context.setCookie(...cookies);
			}
			const id = trace(),
				started = performance.now();
			const results = await Promise.all(
				Array.from({ length: concurrency }, () =>
					page.evaluate(
						async (input) => {
							const response = await fetch(input.pathname, {
								method: "POST",
								headers: input.headers,
								body: input.body,
								credentials: "same-origin",
								signal: AbortSignal.timeout(60000),
							});
							const text = await response.text();
							let payload;
							for (const line of text.split("\n"))
								try {
									const row = JSON.parse(line.slice(line.indexOf(":") + 1));
									if (typeof row?.success === "boolean") {
										payload = row;
										break;
									}
								} catch {}
							if (!payload)
								throw new Error("Actual action result unavailable.");
							return {
								payload,
								servedBy: response.headers.get("x-z8-fixture-instance"),
							};
						},
						{
							...captured,
							headers: {
								...captured.headers,
								"x-z8-fixture-replica": target,
								traceparent: traceparent(id),
							},
						},
					),
				),
			);
			onResponse?.();
			if (results.some((result) => result.servedBy !== target))
				throw new Error("Proxy did not serve the requested actual replica.");
			const payload = results[0].payload,
				data = payload.data;
			const summary = !payload.success
				? {
						success: false,
						code: payload.code,
						denied: [
							"AuthenticationError",
							"AuthorizationError",
							"NotFoundError",
						].includes(payload.code),
						cacheError: payload.code === "ExternalServiceError",
					}
				: kind === "team"
					? {
							success: true,
							employees: data.teams.reduce(
								(count, team) => count + team.employeeCount,
								0,
							),
							totalHours: data.organizationTotal,
							expected: data.teams
								.flatMap((team) => team.employees)
								.reduce((sum, person) => sum + person.expectedHours, 0),
							variance: data.teams
								.flatMap((team) => team.employees)
								.reduce((sum, person) => sum + person.variance, 0),
						}
					: kind === "work"
						? {
								success: true,
								employees: data.byEmployee.length,
								totalHours: data.summary.totalHours,
								overtime: data.summary.overtimeHours,
								undertime: data.summary.undertimeHours,
							}
						: {
								success: true,
								weeks: data.weeklySeries.length,
								seriesOvertime: data.weeklySeries.reduce(
									(sum, week) => sum + week.overtimeHours,
									0,
								),
							};
			return {
				payload,
				summary,
				replica: target,
				concurrency,
				equivalent: results.every(
					(result) =>
						JSON.stringify(result.payload) === JSON.stringify(payload),
				),
				elapsedMs: performance.now() - started,
				metrics: await metrics(id, summary.cacheError === true),
			};
		}
		return {
			browser,
			page,
			context,
			auth,
			fixture,
			kind,
			replay,
			observeMetrics: (id) => metrics(id, false),
			close: () => browser.close(),
		};
	} catch (error) {
		await browser.close().catch(() => {});
		throw error;
	}
}

async function main() {
	const [directory, kind = "team"] = process.argv.slice(2);
	const probe = await openMultiInstanceAnalytics(directory, { kind });
	const observations = [];
	try {
		for (const [stage, replica] of [
			["a-repeat", "a"],
			["b-first", "b"],
			["b-repeat", "b"],
		]) {
			const result = await probe.replay(replica);
			if (
				!result.summary.success ||
				(result.summary.totalHours !== 417600 && kind !== "overtime")
			)
				throw new Error("Literal annual fixture output changed.");
			if (
				stage === "b-first"
					? result.metrics.misses !== 1
					: result.metrics.hits !== 1
			)
				throw new Error(
					"Configured per-process cache outcome did not match actual native telemetry.",
				);
			observations.push({ stage, ...result, payload: undefined });
		}
		await writeFile(
			join(resolve(directory), `multi-${kind}-smoke-metrics.json`),
			JSON.stringify(observations, null, 2),
		);
		console.log(
			JSON.stringify({
				observations: observations.length,
				actualReplicaRoutingVerified: true,
			}),
		);
	} finally {
		await probe.close();
	}
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	main().catch(() => {
		console.error(
			"Multi-instance runtime probe failed; raw data not exported.",
		);
		process.exitCode = 1;
	});
