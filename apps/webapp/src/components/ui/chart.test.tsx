/* @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChartConfig, ChartContainer, ChartTooltipContent } from "./chart";

const chartTestState = vi.hoisted(() => ({
	pending: new Promise<never>(() => undefined),
	suspendResponsiveContainer: false,
}));

afterEach(() => {
	chartTestState.suspendResponsiveContainer = false;
});

vi.mock("recharts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("recharts")>();

	return {
		...actual,
		ResponsiveContainer: ({ children }: { children: ReactNode }) => {
			if (chartTestState.suspendResponsiveContainer) {
				throw chartTestState.pending;
			}

			return children;
		},
	};
});

function StatefulTooltipValue({ name }: { name: string }) {
	const [initialName] = useState(name);

	return <span data-tooltip-name={name}>{initialName}</span>;
}

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) => {
			const translations: Record<string, string> = {
				"common:loading.chart": "Diagramm wird geladen",
				"common:loading.settings": "Einstellungen werden geladen",
			};
			return translations[key] ?? fallback;
		},
	}),
}));

async function renderChart(element: ReactElement) {
	let result: ReturnType<typeof render> | undefined;

	await act(async () => {
		result = render(element);
		await import("recharts");
	});

	if (!result) {
		throw new Error("Chart render did not complete");
	}

	return result;
}

describe("ChartContainer", () => {
	it("preserves chart geometry with a generic fallback while the chart payload loads", async () => {
		chartTestState.suspendResponsiveContainer = true;
		const config: ChartConfig = {
			revenue: {
				label: "Sensitive revenue",
				color: "#2563eb",
			},
		};

		const { container } = await renderChart(
			<ChartContainer className="h-[300px]" config={config}>
				<div>Sensitive chart data</div>
			</ChartContainer>,
		);

		const chart = container.querySelector('[data-slot="chart"]');
		const fallback = screen.getByRole("status", {
			name: "Diagramm wird geladen",
		});

		expect(chart?.className).toContain("aspect-video");
		expect(chart?.className).toContain("h-[300px]");
		expect(fallback.className).toContain("h-full");
		expect(fallback.className).toContain("w-full");
		expect(screen.queryByRole("status", { name: "Loading chart" })).toBeNull();
		expect(screen.queryByText("Sensitive revenue")).toBeNull();
		expect(screen.queryByText("Sensitive chart data")).toBeNull();
	});

	it("preserves safe chart config keys for existing CSS variable consumers", async () => {
		const config: ChartConfig = {
			hours: {
				label: "Hours",
				color: "#2563eb",
			},
		};

		const { container } = await renderChart(
			<ChartContainer config={config}>
				<div />
			</ChartContainer>,
		);

		expect(container.querySelector("style")?.textContent).toContain(
			"--color-hours: #2563eb;",
		);
	});

	it("preserves safe app CSS variable colors", async () => {
		const config: ChartConfig = {
			hours: {
				label: "Hours",
				color: "hsl(var(--chart-1))",
			},
			primary: {
				label: "Primary",
				color: "hsl(var(--primary))",
			},
			destructive: {
				label: "Destructive",
				color: "rgba(var(--destructive))",
			},
		};

		const { container } = await renderChart(
			<ChartContainer config={config}>
				<div />
			</ChartContainer>,
		);

		const style = container.querySelector("style");
		expect(style?.textContent).toContain("--color-hours: hsl(var(--chart-1));");
		expect(style?.textContent).toContain(
			"--color-primary: hsl(var(--primary));",
		);
		expect(style?.textContent).toContain(
			"--color-destructive: rgba(var(--destructive));",
		);
	});

	it("does not interpolate chart config keys into raw CSS identifiers", async () => {
		const maliciousKey = `employee</style><script>alert("xss")</script>`;
		const config: ChartConfig = {
			[maliciousKey]: {
				label: maliciousKey,
				color: "#2563eb",
			},
		};

		const { container } = await renderChart(
			<ChartContainer config={config}>
				<div />
			</ChartContainer>,
		);

		const style = container.querySelector("style");
		expect(style?.textContent).not.toContain(maliciousKey);
		expect(style?.textContent).not.toContain("</style>");
		expect(container.querySelector("script")).toBeNull();
	});

	it("skips chart config colors that are unsafe for CSS interpolation", async () => {
		const config: ChartConfig = {
			hours: {
				label: "Hours",
				color: `red;}</style><script>alert("xss")</script>`,
			},
		};

		const { container } = await renderChart(
			<ChartContainer config={config}>
				<div />
			</ChartContainer>,
		);

		const style = container.querySelector("style");
		expect(style?.textContent).not.toContain("--color-hours");
		expect(style?.textContent).not.toContain("</style>");
		expect(container.querySelector("script")).toBeNull();
	});

	it("does not interpolate chart ids into raw CSS selectors", async () => {
		const maliciousId = `team] { color:red; }</style><script>alert("xss")</script>`;
		const config: ChartConfig = {
			hours: {
				label: "Hours",
				color: "#2563eb",
			},
		};

		const { container } = await renderChart(
			<ChartContainer config={config} id={maliciousId}>
				<div />
			</ChartContainer>,
		);

		const chart = container.querySelector("[data-chart]");
		const style = container.querySelector("style");
		expect(chart?.getAttribute("data-chart")).toBe(
			"chart-team-color-red-style-script-alert-xss-script-0",
		);
		expect(style?.textContent).toContain(
			"[data-chart=chart-team-color-red-style-script-alert-xss-script-0]",
		);
		expect(style?.textContent).not.toContain(maliciousId);
		expect(style?.textContent).not.toContain("</style>");
		expect(container.querySelector("script")).toBeNull();
	});

	it("keeps function-based tooltip series attached to their own rendered state when reordered", async () => {
		const hoursDataKey = (row: { hours: number }) => row.hours;
		const costDataKey = (row: { cost: number }) => row.cost;
		const config: ChartConfig = {
			Hours: { label: "Hours", color: "#2563eb" },
			Cost: { label: "Cost", color: "#16a34a" },
		};
		const hoursPayload = {
			name: "Hours",
			value: 8,
			dataKey: hoursDataKey,
			color: "#2563eb",
			payload: { hours: 8 },
		};
		const costPayload = {
			name: "Cost",
			value: 120,
			dataKey: costDataKey,
			color: "#16a34a",
			payload: { cost: 120 },
		};
		const renderTooltip = (payload: unknown[]) => (
			<ChartContainer config={config}>
				<ChartTooltipContent
					active
					payload={payload as never}
					formatter={(_value, name) => (
						<StatefulTooltipValue name={String(name)} />
					)}
				/>
			</ChartContainer>
		);

		const { container, rerender } = await renderChart(
			renderTooltip([hoursPayload, costPayload]),
		);

		await waitFor(() => {
			expect(container.querySelectorAll("[data-tooltip-name]")).toHaveLength(2);
		});

		await act(async () => {
			rerender(renderTooltip([costPayload, hoursPayload]));
		});

		await waitFor(() => {
			const items = container.querySelectorAll("[data-tooltip-name]");
			expect(items).toHaveLength(2);
			for (const item of items) {
				expect(item.textContent).toBe(item.getAttribute("data-tooltip-name"));
			}
		});
	});
});
