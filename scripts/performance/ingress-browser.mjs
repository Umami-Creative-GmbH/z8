/** Remove complete and unfinished comments without backtracking over streamed React markers. */
function withoutHtmlComments(html) {
	const parts = [];
	let position = 0;
	for (;;) {
		const opening = html.indexOf("<!--", position);
		if (opening === -1) {
			parts.push(html.slice(position));
			return parts.join("");
		}
		parts.push(html.slice(position, opening));
		const closing = html.indexOf("-->", opening + 4);
		if (closing === -1) return parts.join("");
		position = closing + 3;
	}
}

/** Chrome's actual response stream and rendered DOM. None of this is a paint metric. */
export async function observeIngress(page, origin, mode) {
	const session = await page.createCDPSession();
	await session.send("Network.enable");
	const requests = new Map();
	let streamError;
	const started = performance.now();
	session.on(
		"Network.responseReceived",
		async ({ requestId, response, type }) => {
			const url = new URL(response.url);
			if (
				url.origin !== origin ||
				url.pathname !== "/en" ||
				(mode === "first-document"
					? type !== "Document"
					: !response.mimeType.includes("text/x-component"))
			)
				return;
			const headers = Object.fromEntries(
				Object.entries(response.headers).map(([key, value]) => [
					key.toLowerCase(),
					String(value),
				]),
			);
			const row = {
				requestId,
				status: response.status,
				receivedMs: performance.now() - started,
				chunks: 0,
				decodedBytes: 0,
				encodedBytes: 0,
				firstChunkMs: null,
				usefulContentMs: null,
				completeMs: null,
				protectedContentSeen: false,
				text: "",
				ready: false,
				queued: [],
				headers: Object.fromEntries(
					[
						"content-type",
						"content-encoding",
						"cache-control",
						"vary",
						"content-security-policy",
						"x-frame-options",
						"x-content-type-options",
						"x-z8-fixture-instance",
					]
						.filter((key) => headers[key] !== undefined)
						.map((key) => [key, headers[key]]),
				),
			};
			requests.set(requestId, row);
			try {
				const buffered = await session.send("Network.streamResourceContent", {
					requestId,
				});
				if (buffered.bufferedData) accept(row, buffered.bufferedData);
				for (const data of row.queued) accept(row, data);
				row.queued = [];
				row.ready = true;
			} catch (error) {
				streamError = error;
			}
		},
	);
	function accept(row, base64) {
		const bytes = Buffer.from(base64, "base64");
		row.firstChunkMs ??= performance.now() - started;
		row.decodedBytes += bytes.length;
		row.chunks++;
		if (row.decodedBytes > 8 * 1024 * 1024) {
			streamError = new Error(
				"Ingress response exceeded the bounded observation size.",
			);
			return;
		}
		row.text += bytes.toString("utf8");
		// RSC carries the explicit JSON-safe dataset; document proof uses actual HTML,
		// excluding Flight/scripts so a serialized prop cannot masquerade as markup.
		const content =
			mode === "repeat-link"
				? row.text
				: withoutHtmlComments(
						row.text
							.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
							.replace(/<script\b[^>]*>[\s\S]*$/gi, ""),
					);
		if (
			mode === "repeat-link"
				? /"thisWeek":/.test(content)
				: />\s*This Week\s*<\//.test(content)
		)
			row.usefulContentMs ??= performance.now() - started;
		if (/data-widget-id=|data-clock-status=|"initialSnapshot":/.test(content))
			row.protectedContentSeen = true;
	}
	session.on(
		"Network.dataReceived",
		({ requestId, encodedDataLength, data }) => {
			const row = requests.get(requestId);
			if (!row) return;
			row.encodedBytes += encodedDataLength;
			if (data) {
				if (row.ready) accept(row, data);
				else row.queued.push(data);
			}
		},
	);
	session.on("Network.loadingFinished", ({ requestId }) => {
		const row = requests.get(requestId);
		if (row) row.completeMs = performance.now() - started;
	});
	return {
		started,
		assertAvailable() {
			if (streamError)
				throw new Error(
					"Chrome response streaming is unavailable; no early-content proof can be claimed.",
					{ cause: streamError },
				);
		},
		snapshot() {
			return [...requests.values()].map(
				({
					text: _privateBody,
					requestId: _id,
					ready: _ready,
					queued: _queued,
					...row
				}) => ({ ...row }),
			);
		},
		close: () => session.detach(),
	};
}

export async function readDashboardDom(page) {
	return page.evaluate(() => {
		const pathname = location.pathname;
		if (!document.documentElement || !document.body)
			return {
				documentReady: false,
				pathname,
				readyState: document.readyState,
				protectedContent: null,
				clockReady: null,
				usefulSibling: null,
				secondaryPending: null,
				secondaryComplete: null,
				secondaryFailed: null,
				geometry: null,
				viewport: {
					width: innerWidth,
					height: innerHeight,
					documentWidth: null,
					horizontalOverflow: null,
					scrollX,
					scrollY,
				},
			};
		const visible = (node) =>
			node &&
			node.getClientRects().length > 0 &&
			getComputedStyle(node).visibility !== "hidden";
		const widget = document.querySelector('[data-widget-id="upcoming-shifts"]');
		const quick = document.querySelector('[data-widget-id="quick-stats"]');
		const box = widget?.getBoundingClientRect();
		const rectangle = (node) => {
			const rect = node?.getBoundingClientRect();
			return rect
				? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
				: null;
		};
		const headerClock = [
			...document.querySelectorAll(
				'header [data-clock-status="ready"] button[aria-label]',
			),
		].find((node) => visible(node) && !node.disabled);
		const externalScripts = new Set(
			[...document.scripts].filter((node) => node.src).map((node) => node.src),
		);
		const completedScripts = new Set(
			performance
				.getEntriesByType("resource")
				.filter(
					(entry) => entry.initiatorType === "script" && entry.responseEnd > 0,
				)
				.map((entry) => entry.name),
		);
		const active = document.activeElement;
		const focusKind =
			active === document.body
				? "body"
				: active?.matches('button[aria-label="Retry Upcoming Shifts"]')
					? "secondary-retry"
					: active?.closest("header [data-clock-status]")
						? "header-clock"
						: active?.closest("header")
							? "header-other"
							: active?.closest('[data-widget-id="quick-stats"]')
								? "quick-stats"
								: active?.closest('[data-widget-id="upcoming-shifts"]')
									? "secondary"
									: "other";
		return {
			documentReady: true,
			pathname,
			viewport: {
				width: innerWidth,
				height: innerHeight,
				documentWidth: document.documentElement.scrollWidth,
				horizontalOverflow: Math.max(
					0,
					document.documentElement.scrollWidth - innerWidth,
				),
				scrollX,
				scrollY,
			},
			landmarks: {
				header: rectangle(document.querySelector("header")),
				main: rectangle(document.querySelector("main")),
				quickStats: rectangle(quick),
				secondary: rectangle(widget),
				clock: rectangle(headerClock),
			},
			focus: {
				kind: focusKind,
				tag: active?.tagName ?? null,
				connected: active?.isConnected === true,
				visible: Boolean(visible(active)),
				tabIndex: active?.tabIndex ?? null,
				rectangle: rectangle(active),
			},
			busyMarkerCount:
				widget?.querySelectorAll('[aria-busy="true"]').length ?? 0,
			statusMarkerCount:
				widget?.querySelectorAll('[role="status"]').length ?? 0,
			readyState: document.readyState,
			headerCount: document.querySelectorAll("header").length,
			clockStates: Object.fromEntries(
				["pending", "ready", "unavailable"].map((state) => [
					state,
					document.querySelectorAll(`header [data-clock-status="${state}"]`)
						.length,
				]),
			),
			scriptCount: document.scripts.length,
			uniqueExternalScripts: externalScripts.size,
			completedUniqueExternalScripts: [...externalScripts].filter((name) =>
				completedScripts.has(name),
			).length,
			completedScriptResources: performance
				.getEntriesByType("resource")
				.filter(
					(entry) => entry.initiatorType === "script" && entry.responseEnd > 0,
				).length,
			clockReady: Boolean(headerClock),
			clockLabel: headerClock?.getAttribute("aria-label") ?? null,
			usefulSibling: Boolean(
				visible(quick) && quick.textContent.includes("This Week"),
			),
			secondaryPending: Boolean(widget?.querySelector('[aria-busy="true"]')),
			secondaryComplete: Boolean(
				visible(widget) && widget.textContent.includes("No upcoming shifts"),
			),
			secondaryFailed: Boolean(widget?.querySelector('[role="alert"]')),
			geometry: box
				? { x: box.x, y: box.y, width: box.width, height: box.height }
				: null,
			protectedContent: Boolean(
				document.querySelector(
					'header [data-clock-status], [data-widget-id], [data-testid="manager-today-metrics"]',
				),
			),
		};
	});
}

/** Passive admission observation inside the caller's existing navigation deadline. */
export async function waitForAdmissionDom(
	page,
	{
		expectedPath,
		deadline,
		now = () => performance.now(),
		sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
	},
) {
	if (
		!["/en/sign-in", "/en/mfa", "/en/init"].includes(expectedPath) ||
		!Number.isFinite(deadline)
	)
		throw Error(
			"Admission DOM observation requires its declared challenge and navigation deadline.",
		);
	const started = now();
	let attempts = 0,
		documentNotReadySnapshots = 0,
		lastDomSnapshot = { documentReady: false, protectedContent: null };
	while (now() < deadline) {
		lastDomSnapshot = await readDashboardDom(page);
		attempts++;
		if (!lastDomSnapshot.documentReady) documentNotReadySnapshots++;
		if (
			now() < deadline &&
			lastDomSnapshot.documentReady === true &&
			["interactive", "complete"].includes(lastDomSnapshot.readyState) &&
			lastDomSnapshot.pathname === expectedPath
		)
			return {
				...lastDomSnapshot,
				admissionObservation: {
					attempts,
					documentNotReadySnapshots,
					elapsedMs: now() - started,
				},
			};
		if (now() < deadline) await sleep(Math.min(25, deadline - now()));
	}
	const error = Error(
		"Admission document did not settle at its challenge within the existing navigation deadline.",
	);
	error.lastDomSnapshot = lastDomSnapshot;
	error.admissionObservation = {
		attempts,
		documentNotReadySnapshots,
		elapsedMs: now() - started,
	};
	throw error;
}
