/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PositionCaptureReview } from "@/lib/works-council/position-capture-review";
import type { WorksCouncilPortalModel } from "@/lib/works-council/review-data";
import type { VehicleUseReview } from "@/lib/works-council/vehicle-use-review";
import { render as renderWithTranslations } from "@/test/render-with-translations";
import { WorksCouncilDashboard } from "./works-council-dashboard";

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (await import("@/test/render-with-translations")).createTestTolgee().t,
}));

describe("WorksCouncilDashboard", async () => {
	it("renders a disabled state without domain data", async () => {
		const model: WorksCouncilPortalModel = {
			state: "disabled",
			dashboard: null,
			changeLog: [],
			scheduleReview: [],
		};

		render(await WorksCouncilDashboard({ model }));

		expect(screen.getByRole("heading", { name: "Works Council" })).toBeTruthy();
		expect(
			screen.getByText("Works Council Mode is not enabled for this organization."),
		).toBeTruthy();
		expect(screen.queryByText("Policy changes")).toBeNull();
	});

	it("renders ready metrics and change log", async () => {
		const model: WorksCouncilPortalModel = {
			state: "ready",
			dateRange: {
				start: "2026-05-01T00:00:00.000Z",
				end: "2026-05-31T23:59:59.999Z",
			},
			exportEnabled: true,
			dashboard: {
				overtimeMinutes: { state: "insufficient_data", count: 0, value: null },
				breakRestRiskCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				schedulePublicationCount: { state: "available", count: 2, value: 2 },
				scheduleChangeCount: { state: "available", count: 3, value: 3 },
				complianceFindingCount: {
					state: "insufficient_data",
					count: 1,
					value: null,
				},
				absenceCoveragePressureCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
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
					identityState: "hidden",
				},
			],
		};

		render(await WorksCouncilDashboard({ model }));

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
		const exportButton = screen.getByRole("button", {
			name: "Export review pack",
		});
		const exportForm = exportButton.closest("form");
		expect(exportForm?.getAttribute("method")).toBe("post");
		expect(exportForm?.getAttribute("action")).toBe(
			"/works-council/export?from=2026-05-01&to=2026-05-31",
		);
		expect(screen.queryByRole("link", { name: "Export review pack" })).toBeNull();
		expect(screen.getByText("work_policy update")).toBeTruthy();
		expect(screen.getByText("Schedule review")).toBeTruthy();
		expect(screen.getByText("Operations")).toBeTruthy();
	});

	it("renders insufficient data state for suppressed schedule identities", async () => {
		const model: WorksCouncilPortalModel = {
			state: "ready",
			dateRange: {
				start: "2026-05-01T00:00:00.000Z",
				end: "2026-05-31T23:59:59.999Z",
			},
			exportEnabled: false,
			dashboard: {
				overtimeMinutes: { state: "insufficient_data", count: 0, value: null },
				breakRestRiskCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				schedulePublicationCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				scheduleChangeCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				complianceFindingCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				absenceCoveragePressureCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				policyChangeCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
			},
			changeLog: [],
			scheduleReview: [
				{
					id: "schedule-1",
					startsAt: "2026-05-12T08:00:00.000Z",
					endsAt: "2026-05-12T16:00:00.000Z",
					teamName: "Operations",
					employeeName: null,
					identityState: "insufficient_data",
				},
			],
		};

		render(await WorksCouncilDashboard({ model }));

		expect(screen.getByText(/Insufficient data -/)).toBeTruthy();
	});

	it("renders the read-only position capture section when given", async () => {
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
		const review: PositionCaptureReview = {
			enabled: false,
			retentionDays: 90,
			currentNotice: null,
			noticeHistory: [],
			organizationAssignment: null,
			teamAssignments: [],
			employeeAssignments: { state: "counted", switchedOn: 0, switchedOff: 0 },
			consentCounts: { state: "insufficient_data", switchedOnEmployees: 0 },
			accessLog: [],
		};

		renderWithTranslations(
			await WorksCouncilDashboard({ model, positionCapture: { review, locale: "en" } }),
		);

		expect(screen.getByRole("region", { name: "Position capture" })).toBeTruthy();
		expect(screen.getByText("No one has viewed positions.")).toBeTruthy();
	});

	it("renders the read-only vehicle use section when given", async () => {
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
		const review: VehicleUseReview = {
			enabled: false,
			organizationAssignment: null,
			teamAssignments: [],
			employeeAssignments: { state: "counted", asked: 0, expected: 0, off: 0 },
			coveredEmployees: { state: "insufficient_data", coveredEmployees: 0 },
			vehicles: { active: 0, archived: 0 },
		};

		renderWithTranslations(await WorksCouncilDashboard({ model, vehicleUse: { review } }));

		expect(screen.getByRole("region", { name: "Vehicle use" })).toBeTruthy();
		expect(screen.queryByRole("region", { name: "Position capture" })).toBeNull();
	});

	it("renders schedule review empty state and hides export when disabled", async () => {
		const model: WorksCouncilPortalModel = {
			state: "ready",
			dateRange: {
				start: "2026-05-01T00:00:00.000Z",
				end: "2026-05-31T23:59:59.999Z",
			},
			exportEnabled: false,
			dashboard: {
				overtimeMinutes: { state: "insufficient_data", count: 0, value: null },
				breakRestRiskCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				schedulePublicationCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				scheduleChangeCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				complianceFindingCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				absenceCoveragePressureCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
				policyChangeCount: {
					state: "insufficient_data",
					count: 0,
					value: null,
				},
			},
			changeLog: [],
			scheduleReview: [],
		};

		render(await WorksCouncilDashboard({ model }));

		expect(screen.queryByRole("link", { name: "Export review pack" })).toBeNull();
		expect(screen.getByText("No schedule entries found for this period.")).toBeTruthy();
	});

	it("formats date range and timestamps in German (de) and English (en) using explicit organization timezone across DST", async () => {
		const model: WorksCouncilPortalModel = {
			state: "ready",
			dateRange: {
				start: "2026-03-01T00:00:00.000Z",
				end: "2026-03-31T23:59:59.999Z",
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
			changeLog: [
				{
					id: "audit-winter",
					// 13:30 UTC = 14:30 CET (+01:00) in Europe/Berlin before DST spring-forward
					timestamp: "2026-03-28T13:30:00.000Z",
					eventType: "update",
					actorLabel: "Authorized user",
					summary: "winter_event",
				},
				{
					id: "audit-summer",
					// 13:30 UTC = 15:30 CEST (+02:00) in Europe/Berlin after DST spring-forward
					timestamp: "2026-03-29T13:30:00.000Z",
					eventType: "update",
					actorLabel: "Authorized user",
					summary: "summer_event",
				},
			],
			scheduleReview: [],
		};

		const german = render(
			await WorksCouncilDashboard({ model, locale: "de", timezone: "Europe/Berlin" }),
		);
		expect(german.container.textContent).toContain("März 2026");
		expect(german.container.textContent).toContain("14:30");
		expect(german.container.textContent).toContain("15:30");
		german.unmount();

		const english = render(
			await WorksCouncilDashboard({ model, locale: "en", timezone: "Europe/Berlin" }),
		);
		expect(english.container.textContent).toContain("Mar 1, 2026 - Mar 31, 2026");
		expect(english.container.textContent).toContain("2:30 PM");
		expect(english.container.textContent).toContain("3:30 PM");
	});
});
