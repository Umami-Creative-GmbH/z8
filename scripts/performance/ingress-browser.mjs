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
				: row.text
						.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
						.replace(/<script\b[^>]*>[\s\S]*$/gi, "");
		if (
			mode === "repeat-link"
				? /"thisWeek":/.test(content)
				: />\s*(?:<!--[\s\S]*?-->\s*)*This Week(?:<!--[\s\S]*?-->\s*)*<\//.test(
						content,
					)
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
		const visible = (node) =>
			node &&
			node.getClientRects().length > 0 &&
			getComputedStyle(node).visibility !== "hidden";
		const widget = document.querySelector('[data-widget-id="upcoming-shifts"]');
		const quick = document.querySelector('[data-widget-id="quick-stats"]');
		const box = widget?.getBoundingClientRect();
		const headerClock = [
			...document.querySelectorAll(
				'header [data-clock-status="ready"] button[aria-label]',
			),
		].find((node) => visible(node) && !node.disabled);
		return {
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
