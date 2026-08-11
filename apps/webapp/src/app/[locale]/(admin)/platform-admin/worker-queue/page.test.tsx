/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) =>
			key === "common:loading.workerQueue"
				? "Auftragswarteschlange wird geladen"
				: fallback,
	}),
}));

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/tolgee/server", () => ({ getTranslate: vi.fn() }));
vi.mock("./actions", () => ({ getWorkerQueueStats: vi.fn() }));
vi.mock("./recent-executions", () => ({ RecentExecutions: () => null }));
vi.mock("./reliability-charts", () => ({
	WorkerReliabilityCharts: () => null,
}));
vi.mock("./schedule-controls", () => ({ ScheduleControls: () => null }));

const { default: WorkerQueuePage } = await import("./page");

describe("WorkerQueuePage", () => {
	it("renders a meaningful localized fallback while locale params are unresolved", async () => {
		await act(async () => {
			render(<WorkerQueuePage params={new Promise<never>(() => {})} />);
		});

		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText("Auftragswarteschlange wird geladen")).toBeTruthy();
	});

	it("passes locale params to the protected queue content", async () => {
		const page = WorkerQueuePage({
			params: Promise.resolve({ locale: "de" }),
		});
		const content = page.props.children;

		expect(content.type.name).toBe("WorkerQueueContent");
		await expect(content.props.params).resolves.toEqual({ locale: "de" });
	});
});
