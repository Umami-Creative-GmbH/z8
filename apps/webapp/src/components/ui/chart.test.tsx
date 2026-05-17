/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartContainer, type ChartConfig } from "./chart";

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
});
