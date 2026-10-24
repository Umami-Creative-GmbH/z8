/** Browser actions at the application's visible UI boundary; plans never contain executable JavaScript. */
const substitute = (value, bindings) =>
	String(value).replace(
		/\{(locale|employee|employeeSearch|start|end|path)\}/g,
		(_, key) => bindings[key] ?? "",
	);

export async function performSteps(page, steps, bindings, timeout = 30000) {
	for (const step of steps ?? []) {
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
		if (step.click) {
			await page.waitForSelector(selector(step.click), {
				visible: true,
				timeout,
			});
			await page.click(selector(step.click));
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
					await element.click();
					break;
				}
		} else if (step.reveal) {
			const target = await page.$(selector(step.reveal.target));
			if (!target || !(await target.isVisible())) {
				await page.click(selector(step.reveal.trigger));
				await page.waitForSelector(selector(step.reveal.target), {
					visible: true,
					timeout,
				});
			}
		} else if (step.fill)
			await page.locator(selector(step.fill)).fill(selector(step.value));
		else if (step.type)
			await page.type(selector(step.type), selector(step.value));
		else if (step.select)
			await page.select(selector(step.select), selector(step.value));
		else if (step.key) await page.keyboard.press(step.key);
		else if (step.reload)
			await page.reload({ waitUntil: "domcontentloaded", timeout });
		else if (step.wait)
			await page.waitForSelector(selector(step.wait), {
				visible: true,
				timeout,
			});
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
				(await page.$eval(css, (node) => node.getAttribute("aria-checked"))) !==
				expected
			) {
				await page.click(css);
				if (step.checked.accepted)
					await performSteps(page, step.checked.accepted, bindings, timeout);
			}
			await performSteps(
				page,
				[
					{
						attribute: { selector: css, name: "aria-checked", value: expected },
					},
				],
				bindings,
				timeout,
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
	}
}

/** Verified English UI path, fixed 2025 fixture. Shared report/analytics picker has no range URL interface. */
export function historicalRangeSteps(name) {
	if (!["month", "quarter", "year"].includes(name)) return [];
	const choose = (text) => [
		{ click: 'button[aria-label="Period"]:not(:disabled)' },
		{ clickText: { selector: '[role="option"]', text } },
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
export const dashboardLayoutMutation = {
	concurrency: 1,
	steps: [
		{ click: 'button[aria-label="Customize dashboard"]' },
		{ checked: { selector: quickStats, value: false, accepted: savedLayout } },
		{ key: "Escape" },
		{ reload: true },
		{ click: 'button[aria-label="Customize dashboard"]' },
		{
			attribute: { selector: quickStats, name: "aria-checked", value: "false" },
		},
	],
	ready: `${quickStats}[aria-checked="false"]`,
	reset: [
		{ key: "Escape" },
		{ reload: true },
		{ click: 'button[aria-label="Customize dashboard"]' },
		{ checked: { selector: quickStats, value: true, accepted: savedLayout } },
		{ key: "Escape" },
		{ reload: true },
		{ click: 'button[aria-label="Customize dashboard"]' },
		{
			attribute: { selector: quickStats, name: "aria-checked", value: "true" },
		},
		{ key: "Escape" },
	],
};
