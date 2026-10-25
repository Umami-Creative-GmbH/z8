/** Browser actions at the application's visible UI boundary; plans never contain executable JavaScript. */
const substitute = (value, bindings) =>
	String(value).replace(
		/\{(locale|employee|employeeSearch|start|end|path)\}/g,
		(_, key) => bindings[key] ?? "",
	);

export const fixtureBrowserPermissions =
	"notifications-denied-for-fixture-origin";
export async function prepareFixtureBrowserContext(context, origin) {
	// A fresh Chrome context otherwise leaves notifications at default and opens delayed push onboarding over the journey.
	if (!context.id)
		throw new Error("An isolated fixture browser context is required.");
	// Puppeteer's context-scoped CDP connection keeps the override alive for the context lifetime.
	await context.setPermission(origin, {
		permission: { name: "notifications" },
		state: "denied",
	});
}

/** Select across all matches: responsive navigation can retain a hidden duplicate before the useful Link. */
export async function waitVisible(page, selector, timeout = 30000) {
	const deadline = performance.now() + timeout;
	do {
		for (const element of await page.$$(selector)) {
			if (
				(await element.isVisible()) &&
				(await element.evaluate(
					(node) => !node.matches(":disabled,[aria-disabled='true']"),
				))
			)
				return element;
		}
		await new Promise((done) => setTimeout(done, 16));
	} while (performance.now() < deadline);
	const error = new Error("Visible fixture target did not become available.");
	error.name = "TimeoutError";
	throw error;
}

export async function clickVisible(page, selector, timeout = 30000) {
	await (
		await waitVisible(page, selector, timeout)
	)
		.asLocator()
		.setTimeout(timeout)
		.click();
}

async function headerAction(page, action, timeout) {
	const label = { refresh: "Refresh data", customize: "Customize dashboard" }[
		action
	];
	if (!label) throw new Error("Unsupported fixture header action.");
	try {
		const buttons =
			'header button, [data-slot="popover-content"][aria-label="More actions"][data-open]:not([data-ending-style]) button';
		const visible = (node, text) =>
			node.getClientRects().length > 0 &&
			!node.matches(":disabled,[aria-disabled='true']") &&
			(node.getAttribute("aria-label") === text ||
				node.textContent.trim() === text);
		await page.waitForFunction(
			(css, label) =>
				[...document.querySelectorAll(css)].some(
					(node) =>
						node.getClientRects().length > 0 &&
						!node.matches(":disabled") &&
						[label, "More actions"].includes(
							node.getAttribute("aria-label") ?? node.textContent.trim(),
						),
				),
			{ timeout },
			buttons,
			label,
		);
		let candidates = await page.$$(buttons);
		let target;
		for (const button of candidates)
			if (await button.evaluate(visible, label)) {
				target = button;
				break;
			}
		if (!target) {
			for (const button of candidates)
				if (await button.evaluate(visible, "More actions")) {
					await button.asLocator().setTimeout(timeout).click();
					break;
				}
			await page.waitForFunction(
				(css, label) =>
					[...document.querySelectorAll(css)].some(
						(node) =>
							node.getClientRects().length > 0 &&
							!node.matches(":disabled,[aria-disabled='true']") &&
							(node.getAttribute("aria-label") === label ||
								node.textContent.trim() === label),
					),
				{ timeout },
				buttons,
				label,
			);
			candidates = await page.$$(buttons);
			for (const button of candidates)
				if (await button.evaluate(visible, label)) {
					target = button;
					break;
				}
		}
		if (!target) throw new Error("Visible fixture header action unavailable.");
		await target.asLocator().setTimeout(timeout).click();
	} catch (error) {
		error.fixtureHeaderState = await page
			.evaluate(() => {
				const more = document.querySelector(
					'header button[aria-label="More actions"]',
				);
				const box = more?.getBoundingClientRect();
				return {
					permission: Notification.permission,
					morePresent: !!more,
					moreExpanded: more?.getAttribute("aria-expanded"),
					moreHitSlot: box
						? document
								.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
								?.getAttribute("data-slot")
						: null,
					morePopovers: document.querySelectorAll(
						'[data-slot="popover-content"][aria-label="More actions"][data-open]',
					).length,
					actionPanels: document.querySelectorAll(
						'[data-slot="action-panel-content"][data-open]',
					).length,
					refresh: [
						...document.querySelectorAll('button[aria-label="Refresh data"]'),
					].map((node) => ({
						visible: node.getClientRects().length > 0,
						disabled: node.disabled,
						busy: node.getAttribute("aria-busy"),
					})),
				};
			})
			.catch(() => null);
		throw error;
	}
}

export async function performSteps(
	page,
	steps,
	bindings,
	timeout = 30000,
	hooks = {},
) {
	for (const [index, step] of (steps ?? []).entries()) {
		try {
			const selector = (value) => substitute(value, bindings);
			let response;
			if (step.response)
				response = page
					.waitForResponse(
						(candidate) => {
							const url = new URL(candidate.url());
							return (
								url.origin === bindings.origin &&
								url.pathname ===
									selector(step.response.path ?? "{path}").split("?")[0] &&
								(step.response.method === "ANY" ||
									candidate.request().method() ===
										(step.response.method ?? "POST"))
							);
						},
						{ timeout },
					)
					.catch(() => null);
			if (step.headerAction)
				await headerAction(page, step.headerAction, timeout);
			else if (step.click) {
				await clickVisible(page, selector(step.click), timeout);
			} else if (step.clickText) {
				const css = selector(step.clickText.selector);
				const text = selector(step.clickText.text);
				await page.waitForFunction(
					(css, text) =>
						[...document.querySelectorAll(css)].some(
							(node) =>
								node.getClientRects().length &&
								!node.matches(":disabled,[aria-disabled='true']") &&
								node.textContent.trim() === text,
						),
					{ timeout },
					css,
					text,
				);
				for (const element of await page.$$(css))
					if (
						await element.evaluate(
							(node, text) =>
								node.getClientRects().length > 0 &&
								!node.matches(":disabled,[aria-disabled='true']") &&
								node.textContent.trim() === text,
							text,
						)
					) {
						await element.asLocator().setTimeout(timeout).click();
						break;
					}
			} else if (step.reveal) {
				let visible = false;
				for (const target of await page.$$(selector(step.reveal.target)))
					if (await target.isVisible()) {
						visible = true;
						break;
					}
				if (!visible) {
					await clickVisible(page, selector(step.reveal.trigger), timeout);
					await waitVisible(page, selector(step.reveal.target), timeout);
				}
			} else if (step.fill) {
				const css = selector(step.fill);
				const value = selector(step.value);
				const input = await waitVisible(page, css, timeout);
				await input.click();
				await page.keyboard.down("Control");
				await page.keyboard.press("A");
				await page.keyboard.up("Control");
				await input.type(value);
				await page.waitForFunction(
					(css, value) =>
						[...document.querySelectorAll(css)].some(
							(node) =>
								node.getClientRects().length > 0 && node.value === value,
						),
					{ timeout },
					css,
					value,
				);
			} else if (step.type)
				await page.type(selector(step.type), selector(step.value));
			else if (step.select)
				await page.select(selector(step.select), selector(step.value));
			else if (step.key) await page.keyboard.press(step.key);
			else if (step.reload) {
				if (hooks.beforeReload) await hooks.beforeReload({ stepIndex: index });
				await page.reload({ waitUntil: "domcontentloaded", timeout });
			} else if (step.wait)
				await waitVisible(page, selector(step.wait), timeout);
			else if (step.absent)
				await page.waitForSelector(selector(step.absent), {
					hidden: true,
					timeout,
				});
			else if (step.text)
				await page.waitForFunction(
					(css, expected) =>
						[...document.querySelectorAll(css)].some(
							(node) =>
								node.getClientRects().length &&
								node.textContent.replace(/\s+/g, " ").trim() === expected,
						),
					{ timeout },
					selector(step.text.selector),
					selector(step.text.value),
				);
			else if (step.attribute)
				await page.waitForFunction(
					(css, name, value) =>
						document.querySelector(css)?.getAttribute(name) === value,
					{ timeout },
					selector(step.attribute.selector),
					step.attribute.name,
					selector(step.attribute.value),
				);
			else if (step.checked) {
				const css = selector(step.checked.selector);
				await page.waitForSelector(css, { visible: true, timeout });
				const expected = String(step.checked.value);
				if (
					(await page.$eval(css, (node) =>
						node.getAttribute("aria-checked"),
					)) !== expected
				) {
					await page.click(css);
					if (step.checked.accepted)
						await performSteps(
							page,
							step.checked.accepted,
							bindings,
							timeout,
							hooks,
						);
				}
				await performSteps(
					page,
					[
						{
							attribute: {
								selector: css,
								name: "aria-checked",
								value: expected,
							},
						},
					],
					bindings,
					timeout,
					hooks,
				);
			} else if (step.card)
				await page.waitForFunction(
					(title, text) =>
						[...document.querySelectorAll('[data-slot="card-title"]')].some(
							(node) =>
								node.textContent.trim() === title &&
								node
									.closest('[data-slot="card"]')
									?.querySelector('[data-slot="card-content"]')
									?.textContent.includes(text),
						),
					{ timeout },
					selector(step.card.title),
					selector(step.card.contains),
				);
			else if (step.table)
				await page.waitForFunction(
					(title, rows, column, value) => {
						const heading = [
							...document.querySelectorAll('[data-slot="card-title"]'),
						].find((node) => node.textContent.trim() === title);
						const entries = heading
							? [
									...heading
										.closest('[data-slot="card"]')
										.querySelectorAll("tbody tr"),
								]
							: [];
						return (
							entries.length === rows &&
							entries.every(
								(row) =>
									row.querySelectorAll("td")[column]?.textContent.trim() ===
									value,
							)
						);
					},
					{ timeout },
					selector(step.table.title),
					step.table.rows,
					step.table.column,
					selector(step.table.value),
				);
			else throw new Error("Unsupported fixture journey action.");
			if (response && !(await response)?.ok())
				throw new Error("Fixture journey request failed.");
		} catch (error) {
			if (step.fill)
				error.fixtureReadiness = await page
					.evaluate(
						(css) => ({
							matchingInputs: document.querySelectorAll(css).length,
							visibleInputs: [...document.querySelectorAll(css)].filter(
								(node) => node.getClientRects().length > 0,
							).length,
							permission: Notification.permission,
							pushPromptOpen: [
								...document.querySelectorAll(
									'[data-slot="action-panel-title"]',
								),
							].some((node) => node.textContent.trim() === "Stay Updated"),
							directoryPath: location.pathname.endsWith("/settings/employees"),
							readyState: document.readyState,
						}),
						substitute(step.fill, bindings),
					)
					.catch(() => null);
			error.fixtureAction ??=
				[
					"headerAction",
					"click",
					"clickText",
					"reveal",
					"fill",
					"type",
					"select",
					"key",
					"reload",
					"wait",
					"absent",
					"text",
					"attribute",
					"checked",
					"card",
					"table",
				].find((name) => step[name] !== undefined) ?? "unsupported";
			error.fixtureStep ??= index;
			throw error;
		}
	}
}

/** Verified English UI path, fixed 2025 fixture. Shared report/analytics picker has no range URL interface. */
export function historicalRangeSteps(name) {
	if (!["month", "quarter", "year"].includes(name)) return [];
	const choose = (text) => [
		{ click: 'button[aria-label="Period"]:not(:disabled)' },
		{ clickText: { selector: '[role="option"]', text } },
		{ absent: '[data-slot="select-content"]' },
	];
	const steps = choose("Last Year");
	if (name !== "year") {
		steps.push(
			...choose("Custom Range"),
			{ wait: '[data-slot="calendar"]' },
			{ click: '[data-slot="calendar"] button[aria-label*="Next"]' },
			{ wait: 'button[data-day="2025-03-31"]' },
		);
		if (name === "month")
			steps.push(
				{ click: 'button[data-day="2025-03-01"]' },
				{ click: 'button[data-day="2025-03-01"]' },
			);
		steps.push(
			{ click: 'button[data-day="2025-03-31"]' },
			{ key: "Escape" },
			{ absent: '[data-slot="calendar"]' },
			{
				text: {
					selector: "button",
					value:
						name === "month"
							? "Mar 1, 2025 - Mar 31, 2025"
							: "Jan 1, 2025 - Mar 31, 2025",
				},
			},
		);
	}
	return steps;
}

const savedLayout = [
	{
		text: {
			selector: '[data-sonner-toast][data-type="success"]',
			value: "Dashboard layout saved",
		},
	},
];
const quickStats =
	'[data-testid="dashboard-widget-menu-row-quick-stats"] [role="menuitemcheckbox"]';
export const headerRefreshSteps = [
	{ headerAction: "refresh", response: { path: "{path}", method: "ANY" } },
	{
		attribute: {
			selector: 'button[aria-label="Refresh data"]',
			name: "aria-busy",
			value: "false",
		},
	},
	{ key: "Escape" },
	{ absent: '[data-slot="popover-content"][aria-label="More actions"]' },
];
export const dashboardLayoutMutation = {
	concurrency: 1,
	steps: [
		{ headerAction: "customize" },
		{ checked: { selector: quickStats, value: false, accepted: savedLayout } },
		{ key: "Escape" },
		{ reload: true },
		{ headerAction: "customize" },
		{
			attribute: { selector: quickStats, name: "aria-checked", value: "false" },
		},
	],
	ready: `${quickStats}[aria-checked="false"]`,
	reset: [
		{ key: "Escape" },
		{ reload: true },
		{ headerAction: "customize" },
		{ checked: { selector: quickStats, value: true, accepted: savedLayout } },
		{ key: "Escape" },
		{ reload: true },
		{ headerAction: "customize" },
		{
			attribute: { selector: quickStats, name: "aria-checked", value: "true" },
		},
		{ key: "Escape" },
	],
};
