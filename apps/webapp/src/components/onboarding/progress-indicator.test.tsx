/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (_match, name: string) =>
				String(params?.[name] ?? `{${name}}`),
			),
	}),
}));

import { ProgressIndicator } from "./progress-indicator";

afterEach(() => {
	cleanup();
});

describe("ProgressIndicator", () => {
	it("lays every step out in an equal-width column", () => {
		render(<ProgressIndicator currentStep="wellness" isAdmin />);

		const list = screen.getByRole("list");
		expect(screen.getAllByRole("listitem")).toHaveLength(9);
		expect(list.style.gridTemplateColumns).toBe("repeat(9, minmax(0, 1fr))");
	});

	it("runs the progress line from the first circle centre to the current one", () => {
		render(<ProgressIndicator currentStep="wellness" isAdmin />);

		// 9 columns: centres sit 1/18 in from each edge; wellness is step 7, six columns along.
		const line = screen.getByTestId("onboarding-progress-line");
		expect(Number.parseFloat(line.style.left)).toBeCloseTo(100 / 18);
		expect(Number.parseFloat(line.style.width)).toBeCloseTo((6 * 100) / 9);
	});

	it("draws no progress on the first step", () => {
		render(<ProgressIndicator currentStep="welcome" isAdmin={false} />);

		expect(screen.getByTestId("onboarding-progress-line").style.width).toBe("0%");
	});

	it("marks the current step and names it under the circles for phones", () => {
		render(<ProgressIndicator currentStep="profile" isAdmin={false} />);

		const current = screen.getByRole("listitem", { current: "step" });
		expect(current.textContent).toContain("Profile");
		expect(screen.getByText("Step 3 of 6")).toBeTruthy();
	});

	it("keeps step labels for screen readers while hiding them visually below sm", () => {
		render(<ProgressIndicator currentStep="profile" isAdmin={false} />);

		const label = screen.getByText("Notifications");
		expect(label.className).toContain("sr-only");
		expect(label.className).toContain("sm:not-sr-only");
	});
});
