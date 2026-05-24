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
			dashboard: {
				overtimeMinutes: 0,
				breakRestRiskCount: 0,
				schedulePublicationCount: 2,
				scheduleChangeCount: 3,
				complianceFindingCount: 1,
				absenceCoveragePressureCount: 0,
				policyChangeCount: 4,
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
			scheduleReview: [],
		};

		render(<WorksCouncilDashboard model={model} />);

		expect(
			screen.getByText("Privacy-filtered workforce review for the selected period."),
		).toBeTruthy();
		expect(within(screen.getByLabelText("Policy changes")).getByText("4")).toBeTruthy();
		expect(within(screen.getByLabelText("Schedule changes")).getByText("3")).toBeTruthy();
		expect(screen.getByText("work_policy update")).toBeTruthy();
	});
});
