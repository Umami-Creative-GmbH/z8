/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type ChartConfig, ChartContainer } from "./chart";

describe("ChartContainer", () => {
	it("preserves safe chart config keys for existing CSS variable consumers", () => {
		const config: ChartConfig = {
			hours: {
				label: "Hours",
				color: "#2563eb",
			},
		};

		const { container } = render(
			<ChartContainer config={config}>
				<div />
			</ChartContainer>,
		);

		expect(container.querySelector("style")?.textContent).toContain("--color-hours: #2563eb;");
	});

	it("preserves safe app CSS variable colors", () => {
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

		const { container } = render(
			<ChartContainer config={config}>
				<div />
			</ChartContainer>,
		);

		const style = container.querySelector("style");
		expect(style?.textContent).toContain("--color-hours: hsl(var(--chart-1));");
		expect(style?.textContent).toContain("--color-primary: hsl(var(--primary));");
		expect(style?.textContent).toContain("--color-destructive: rgba(var(--destructive));");
	});

	it("does not interpolate chart config keys into raw CSS identifiers", () => {
		const maliciousKey = `employee</style><script>alert("xss")</script>`;
		const config: ChartConfig = {
			[maliciousKey]: {
				label: maliciousKey,
				color: "#2563eb",
			},
		};

		const { container } = render(
			<ChartContainer config={config}>
				<div />
			</ChartContainer>,
		);

		const style = container.querySelector("style");
		expect(style?.textContent).not.toContain(maliciousKey);
		expect(style?.textContent).not.toContain("</style>");
		expect(container.querySelector("script")).toBeNull();
	});

	it("skips chart config colors that are unsafe for CSS interpolation", () => {
		const config: ChartConfig = {
			hours: {
				label: "Hours",
				color: `red;}</style><script>alert("xss")</script>`,
			},
		};

		const { container } = render(
			<ChartContainer config={config}>
				<div />
			</ChartContainer>,
		);

		const style = container.querySelector("style");
		expect(style?.textContent).not.toContain("--color-hours");
		expect(style?.textContent).not.toContain("</style>");
		expect(container.querySelector("script")).toBeNull();
	});

	it("does not interpolate chart ids into raw CSS selectors", () => {
		const maliciousId = `team] { color:red; }</style><script>alert("xss")</script>`;
		const config: ChartConfig = {
			hours: {
				label: "Hours",
				color: "#2563eb",
			},
		};

		const { container } = render(
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
});
