/** Actual authenticated header UI. The caller owns Page/auth/replica/trace interception. */
import { waitVisible } from "./journey-steps.mjs";
import { observationTimeoutMs } from "./clean-evidence.mjs";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function resultFrom(text) {
	try {
		return JSON.parse(text);
	} catch {}
	for (const line of text.split("\n"))
		try {
			const result = JSON.parse(line.slice(line.indexOf(":") + 1));
			if (typeof result?.isClockedIn === "boolean") return result;
		} catch {}
	return null;
}

async function verifyActor(page, expected) {
	const current = await page.evaluate(async () => {
		const response = await fetch("/api/auth/get-session", {
			credentials: "same-origin",
			cache: "no-store",
			signal: AbortSignal.timeout(5000),
		});
		return response.ok ? response.json() : null;
	});
	if (
		current?.user?.email !== expected.email ||
		current?.session?.activeOrganizationId !== expected.organizationId ||
		current?.mfaRequired ||
		current?.ssoRequired
	)
		throw new Error("Actual header actor does not match the fixture workload.");
}

/** No invented command bodies, action IDs, hidden clicks or automatic write retries. */
export async function openPublicHeaderClock(
	page,
	{ origin, expectedActor, phase = "release", timeoutMs = observationTimeoutMs(phase) },
) {
	const url = new URL(origin);
	if (
		url.protocol !== "http:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		!expectedActor?.email ||
		!expectedActor.organizationId ||
		!Number.isFinite(timeoutMs) ||
		timeoutMs < 1 ||
		observationTimeoutMs(phase) === undefined ||
		timeoutMs > observationTimeoutMs(phase)
	)
		throw new Error(
			"An authenticated loopback fixture and bounded timeout are required.",
		);
	let knownStatus = null,
		armed = false,
		needsResolution = false;
	const observeStatus = async (response) => {
		if (!response.request().headers()["next-action"]) return;
		const value = resultFrom(await response.text().catch(() => ""));
		if (typeof value?.isClockedIn === "boolean") knownStatus = value;
	};
	page.on("response", observeStatus);

	async function state() {
		return page.evaluate((known) => {
			const button = [
				...document.querySelectorAll(
					'header button[aria-label="Clock In"],header button[aria-label="Clock Out"]',
				),
			].find((node) => node.getClientRects().length && !node.disabled);
			if (!button) return null;
			const value =
				button.getAttribute("aria-label") === "Clock In" ? "out" : "in";
			if (
				!button.closest('[data-clock-status="ready"]') &&
				(known?.hasEmployee !== true || known.isClockedIn !== (value === "in"))
			)
				return null;
			return value;
		}, knownStatus);
	}
	async function waitState(expected) {
		const deadline = performance.now() + timeoutMs;
		while (performance.now() < deadline) {
			const current = await state();
			if (current && (!expected || current === expected)) return current;
			await pause(25);
		}
		throw new Error("Authoritative usable header state did not settle.");
	}
	async function resolveState() {
		if (armed) throw new Error("A header command is already prepared.");
		knownStatus = null;
		await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
		await verifyActor(page, expectedActor);
		const current = await waitState();
		needsResolution = false;
		return current;
	}
	try {
		await page.goto(`${url.origin}/en`, {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		await verifyActor(page, expectedActor);
		const capabilities = await page.evaluate(async () => {
			const response = await fetch("/api/time-entries/commands", {
				credentials: "same-origin",
				cache: "no-store",
				signal: AbortSignal.timeout(5000),
			});
			return response.ok ? response.json() : null;
		});
		if (
			capabilities?.onlineSubmit !== "available" ||
			capabilities?.submit !== "unavailable"
		)
			throw new Error(
				"The unchanged online legacy fixture is required before clock writes.",
			);
		await waitState("out");
	} catch (error) {
		page.off("response", observeStatus);
		throw error;
	}

	async function prepare(action) {
		if (!["in", "out"].includes(action) || armed || needsResolution)
			throw new Error(
				"Resolve previous work before preparing one header command.",
			);
		armed = true;
		let button;
		try {
			await waitState(action === "in" ? "out" : "in");
			const label = action === "in" ? "Clock In" : "Clock Out";
			const trigger = await waitVisible(
				page,
				`header button[aria-label="${label}"]`,
				timeoutMs,
			);
			if (
				(await trigger.evaluate((node) =>
					node.getAttribute("aria-expanded"),
				)) !== "true"
			)
				await trigger.asLocator().setTimeout(timeoutMs).click();
			await page.waitForFunction(
				(label) =>
					[
						...document.querySelectorAll(
							'[data-slot="popover-content"] button',
						),
					].some(
						(node) =>
							node.textContent.trim() === label &&
							node.getClientRects().length &&
							!node.disabled,
					),
				{ timeout: timeoutMs },
				label,
			);
			for (const candidate of await page.$$(
				'[data-slot="popover-content"] button',
			))
				if (
					await candidate.evaluate(
						(node, label) =>
							node.textContent.trim() === label &&
							node.getClientRects().length &&
							!node.disabled,
						label,
					)
				) {
					button = candidate;
					break;
				}
			if (!button) throw new Error("Actual header submit control unavailable.");
		} catch (error) {
			armed = false;
			throw error;
		}
		let submitted = false;
		return {
			async submit() {
				if (submitted)
					throw new Error(
						"A prepared header write can be submitted only once.",
					);
				submitted = true;
				const started = performance.now();
				let sent = false,
					outcomeKnown = false,
					httpStatus = null,
					commandResponseMs = null,
					clockReadyMs = null;
				const observe = (request) => {
					if (
						new URL(request.url()).pathname === "/api/time-clock" &&
						request.method() === "POST"
					)
						sent = true;
				};
				page.on("request", observe);
				const response = page.waitForResponse(
					(value) =>
						new URL(value.url()).pathname === "/api/time-clock" &&
						value.request().method() === "POST" &&
						resultFrom(value.request().postData() ?? "")?.action ===
							`clock_${action}`,
					{ timeout: timeoutMs },
				);
				response.catch(() => {});
				try {
					await button.asLocator().setTimeout(timeoutMs).click();
					const received = await response;
					const payload = resultFrom(await received.text());
					httpStatus = received.status();
					outcomeKnown = typeof payload?.success === "boolean";
					commandResponseMs = performance.now() - started;
					if (!received.ok() || payload?.success !== true)
						throw new Error("Public clock write refused.");
					await waitState(action === "in" ? "in" : "out");
					clockReadyMs = performance.now() - started;
					if (action === "out")
						for (const skip of await page.$$(
							'[data-slot="popover-content"] button',
						))
							if (
								await skip.evaluate(
									(node) =>
										node.textContent.trim() === "Skip" &&
										node.getClientRects().length,
								)
							) {
								await skip.click();
								break;
							}
					return {
						success: true,
						censored: false,
						unknownCommandOutcome: false,
						httpStatus,
						commandResponseMs,
						clockReadyMs,
						elapsedUntilFailureMs: null,
					};
				} catch {
					needsResolution = sent;
					return {
						success: false,
						censored: true,
						unknownCommandOutcome: sent && !outcomeKnown,
						httpStatus,
						commandResponseMs,
						clockReadyMs,
						elapsedUntilFailureMs: performance.now() - started,
					};
				} finally {
					armed = false;
					page.off("request", observe);
				}
			},
		};
	}
	return {
		prepare,
		state,
		resolveState,
		dispose: () => page.off("response", observeStatus),
	};
}
