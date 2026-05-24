/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { WorksCouncilDashboard } from "./works-council-dashboard";

describe("WorksCouncilDashboard", () => {
	it("renders a disabled state without domain data", () => {
		const model: WorksCouncilPortalModel = {
			state: "disabled",
			dashboard: null,
			changeLog: [],
			scheduleReview: [],
		};

		render(<WorksCouncilDashboard model={model} />);

		expect(screen.getByRole("heading", { name: "Works Council" })).toBeTruthy();
		expect(
			screen.getByText("Works Council Mode is not enabled for this organization."),
		).toBeTruthy();
		expect(screen.queryByText("Policy changes")).toBeNull();
	});

	it("renders ready metrics and change log", () => {
		const model: WorksCouncilPortalModel = {
			state: "ready",
			dateRange: {
				start: "2026-05-01T00:00:00.000Z",
				end: "2026-05-31T23:59:59.999Z",
			},
			exportEnabled: true,
			dashboard: {
				overtimeMinutes: { state: "insufficient_data", count: 0, value: null },
				breakRestRiskCount: { state: "insufficient_data", count: 0, value: null },
				schedulePublicationCount: { state: "available", count: 2, value: 2 },
				scheduleChangeCount: { state: "available", count: 3, value: 3 },
				complianceFindingCount: { state: "insufficient_data", count: 1, value: null },
				absenceCoveragePressureCount: { state: "insufficient_data", count: 0, value: null },
				policyChangeCount: { state: "available", count: 4, value: 4 },
			},
			changeLog: [
				{
					id: "audit-1",
					timestamp: "2026-05-10T12:00:00.000Z",
					eventType: "update",
					actorLabel: "Authorized user",
					summary: "work_policy update",
				},
			],
			scheduleReview: [
				{
					id: "schedule-1",
					startsAt: "2026-05-12T08:00:00.000Z",
					endsAt: "2026-05-12T16:00:00.000Z",
					teamName: "Operations",
					employeeName: null,
				},
			],
		};

		render(<WorksCouncilDashboard model={model} />);

		expect(
			screen.getByText("Privacy-filtered workforce review for the selected period."),
		).toBeTruthy();
		expect(within(screen.getByLabelText("Policy changes")).getByText("4")).toBeTruthy();
		expect(within(screen.getByLabelText("Schedule changes")).getByText("3")).toBeTruthy();
		expect(
			within(screen.getByLabelText("Compliance findings")).getByText("Insufficient data"),
		).toBeTruthy();
		expect(screen.getByText("May 1, 2026 - May 31, 2026")).toBeTruthy();
		expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-05-01");
		expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("2026-05-31");
		expect(screen.getByRole("link", { name: "Export review pack" }).getAttribute("href")).toBe(
			"/works-council/export?from=2026-05-01&to=2026-05-31",
		);
		expect(screen.getByText("work_policy update")).toBeTruthy();
		expect(screen.getByText("Schedule review")).toBeTruthy();
		expect(screen.getByText("Operations")).toBeTruthy();
	});

	it("renders schedule review empty state and hides export when disabled", () => {
		const model: WorksCouncilPortalModel = {
			state: "ready",
			dateRange: {
				start: "2026-05-01T00:00:00.000Z",
				end: "2026-05-31T23:59:59.999Z",
			},
			exportEnabled: false,
			dashboard: {
				overtimeMinutes: { state: "insufficient_data", count: 0, value: null },
				breakRestRiskCount: { state: "insufficient_data", count: 0, value: null },
				schedulePublicationCount: { state: "insufficient_data", count: 0, value: null },
				scheduleChangeCount: { state: "insufficient_data", count: 0, value: null },
				complianceFindingCount: { state: "insufficient_data", count: 0, value: null },
				absenceCoveragePressureCount: { state: "insufficient_data", count: 0, value: null },
				policyChangeCount: { state: "insufficient_data", count: 0, value: null },
			},
			changeLog: [],
			scheduleReview: [],
		};

		render(<WorksCouncilDashboard model={model} />);

		expect(screen.queryByRole("link", { name: "Export review pack" })).toBeNull();
		expect(screen.getByText("No schedule entries found for this period.")).toBeTruthy();
	});
});
