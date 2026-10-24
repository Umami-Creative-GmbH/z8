/** Only the fresh profile owned by this launch is configured; app network requests remain observable. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

export const fixtureBrowserPolicy = "isolated-profile-no-prediction-v1";
const preferences = {
	net: { network_prediction_options: 2 },
	search: { suggest_enabled: false },
	default_search_provider: { enabled: false },
};

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
