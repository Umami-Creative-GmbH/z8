/** Only the fresh profile owned by this launch is configured; app network requests remain observable. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

export const fixtureBrowserPolicy = "isolated-profile-no-prediction-v1";
const preferences = {
	net: { network_prediction_options: 2 },
	search: { suggest_enabled: false },
	default_search_provider: { enabled: false },
};

/** Pure acceptance guard: retained startup evidence never cancels later errors. */
export function fixtureTransportIsComplete(snapshot) {
	const init = snapshot?.browserInitialization,
		after = snapshot?.afterInitialization;
	if (
		!init ||
		!after ||
		init.policy !== fixtureBrowserPolicy ||
		init.complete !== true ||
		init.capped !== false ||
		init.emptyContext !== true ||
		init.quietMs !== 2000 ||
		init.capMs !== 10000 ||
		!(init.quietObservedMs >= 2000) ||
		!(init.elapsedMs >= init.quietObservedMs && init.elapsedMs < 10000) ||
		init.pending !== 0 ||
		init.requests !== 0 ||
		init.responseBodyBytes !== 0 ||
		init.upstreamFailures !== 0 ||
		after.refusedRequests !== 0 ||
		after.upstreamFailures !== 0 ||
		init.launch?.policy !== fixtureBrowserPolicy ||
		JSON.stringify(init.launch.preferences) !== JSON.stringify(preferences) ||
		!init.launch.arguments?.some(
			(arg) =>
				arg.startsWith("--disable-features=") &&
				arg
					.slice("--disable-features=".length)
					.split(",")
					.includes("AutofillServerCommunication"),
		) ||
		!/^Chrome\//.test(init.launch.browserVersion ?? "")
	)
		return false;
	const fields = [
		"requests",
		"rewrittenRequests",
		"refusedRequests",
		"upstreamFailures",
		"responseBodyBytes",
	];
	const reasons = [
		"unexpectedLoopback",
		"nonLoopbackHttp",
		"loopbackConnect",
		"nonLoopbackConnect",
		"malformed",
	];
	for (const counters of [snapshot, init, after]) {
		if (
			fields.some(
				(key) => !Number.isSafeInteger(counters[key]) || counters[key] < 0,
			) ||
			reasons.some(
				(key) =>
					!Number.isSafeInteger(counters.refusalReasons?.[key]) ||
					counters.refusalReasons[key] < 0,
			) ||
			reasons.reduce((sum, key) => sum + counters.refusalReasons[key], 0) !==
				counters.refusedRequests
		)
			return false;
	}
	if (
		fields.some((key) => snapshot[key] !== init[key] + after[key]) ||
		reasons.some(
			(key) =>
				snapshot.refusalReasons[key] !==
				init.refusalReasons[key] + after.refusalReasons[key],
		) ||
		reasons.some(
			(key) => key !== "nonLoopbackConnect" && init.refusalReasons[key] !== 0,
		)
	)
		return false;
	return true;
}

export async function launchFixtureBrowser(puppeteer, executablePath) {
	const profile = await mkdtemp(join(tmpdir(), "z8-performance-chrome-"));
	try {
		await mkdir(join(profile, "Default"));
		await writeFile(
			join(profile, "Default", "Preferences"),
			JSON.stringify(preferences),
		);
		const browser = await puppeteer.launch({
			executablePath,
			headless: true,
			userDataDir: profile,
			args: ["--disable-features=AutofillServerCommunication"],
		});
		browser.fixtureLaunchPolicy = {
			policy: fixtureBrowserPolicy,
			profileDirectorySha256: createHash("sha256").update(profile).digest("hex"),
			headless: true,
			preferences: structuredClone(preferences),
			arguments: browser
				.process()
				.spawnargs.slice(1)
				.filter(
					(argument) =>
						!argument.startsWith("--user-data-dir=") &&
						!argument.startsWith("--remote-debugging-port="),
				),
			browserVersion: await browser.version(),
		};
		const close = browser.close.bind(browser);
		browser.close = async () => {
			try {
				await close();
			} finally {
				await rm(profile, { recursive: true, force: true });
			}
		};
		return browser;
	} catch (error) {
		await rm(profile, { recursive: true, force: true });
		throw error;
	}
}

/** Run exactly once, before cookies, permissions or any app IO, on a newly created context. */
export async function initializeFixtureBrowserContext({ context, transport }) {
	if (
		context.browser().fixtureLaunchPolicy?.policy !== fixtureBrowserPolicy ||
		(await context.pages()).length !== 0 ||
		transport.snapshot().requests !== 0
	)
		throw Error("Browser initialization requires an empty fresh context.");
	const page = await context.newPage();
	if (page.url() !== "about:blank")
		throw Error("Browser initialization requires about:blank.");
	const started = performance.now();
	let quietSince = started,
		previous,
		evidence;
	do {
		const at = performance.now(),
			counts = transport.snapshot(),
			wire = transport.wire.state(at);
		const activity = JSON.stringify(counts);
		if (activity !== previous) {
			previous = activity;
			quietSince = at;
		}
		const pending = Object.values(wire.groups).reduce(
			(sum, group) => sum + group.pending,
			0,
		);
		evidence = {
			policy: fixtureBrowserPolicy,
			launch: structuredClone(context.browser().fixtureLaunchPolicy),
			emptyContext: page.url() === "about:blank",
			quietMs: 2000,
			capMs: 10000,
			quietObservedMs: at - quietSince,
			elapsedMs: at - started,
			pending,
			...counts,
			complete: false,
			capped: at - started >= 10000,
		};
		if (
			!evidence.emptyContext ||
			counts.requests !== 0 ||
			counts.responseBodyBytes !== 0 ||
			counts.upstreamFailures !== 0 ||
			counts.refusalReasons.unexpectedLoopback !== 0 ||
			counts.refusalReasons.nonLoopbackHttp !== 0 ||
			counts.refusalReasons.loopbackConnect !== 0 ||
			counts.refusalReasons.malformed !== 0
		)
			throw Error("Empty browser initialization performed unexpected IO.");
		if (!evidence.capped && pending === 0 && evidence.quietObservedMs >= 2000) {
			evidence.complete = true;
			break;
		}
		if (evidence.capped) break;
		await pause(50);
	} while (!evidence.complete && !evidence.capped);
	if (!evidence.complete)
		throw Error("Empty browser initialization did not settle.");
	transport.finishBrowserInitialization(evidence);
	return { page, browserInitialization: evidence };
}
