/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppendAssuranceReport } from "@/lib/time-tracking/append-assurance";
import type { HistoricalWorkDiagnostics } from "@/lib/time-tracking/historical-work-diagnostics";
import { WorkDiagnosticsDashboard, type WorkDiagnosticsView } from "./work-diagnostics-dashboard";

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

const t = (_key: string, defaultValue?: string, params?: Record<string, string | number>) =>
	(defaultValue ?? _key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name]));

const worker = "a0000000-0000-4000-8000-000000000001";

function report(overrides: Partial<HistoricalWorkDiagnostics> = {}): HistoricalWorkDiagnostics {
	return {
		organizationId: "org-1",
		scope: {
			employeeIds: [worker],
			range: { start: "2026-06-30T10:00:00Z", endExclusive: "2026-08-01T14:00:00Z" },
		},
		completeness: {
			status: "complete",
			widenedTo: "requested",
			affectedEmployeeIds: [],
			blockingFindingIds: [],
		},
		findings: [],
		...overrides,
	};
}

function assurance(overrides: Partial<AppendAssuranceReport> = {}): AppendAssuranceReport {
	return {
		organizationId: "org-1",
		employeeId: worker,
		entryCount: 2,
		entries: [],
		hashes: { reproduced: 2, notReproduced: [], inputUnavailable: [], duplicates: [] },
		links: { stored: 1, derived: 0, roots: 1, unresolved: 0 },
		lineage: { status: "single", rootId: "e1", tip: { id: "e2", hash: "h2" } },
		continuity: { status: "not_adopted" },
		assurance: {
			scope: "whole_history",
			limitations: [{ code: "payroll_readiness_not_assessed" }],
		},
		...overrides,
	};
}

function view(overrides: Partial<WorkDiagnosticsView> = {}): WorkDiagnosticsView {
	return {
		report: report(),
		appendAssurance: [{ employeeId: worker, report: assurance() }],
		employeeLabels: { [worker]: "Wanda Worker" },
		period: { startDate: "2026-07-01", endDate: "2026-07-31" },
		selectedEmployeeId: null,
		hrefFor: ({ employeeId, month }) => `?employee=${employeeId ?? ""}&month=${month ?? ""}`,
		...overrides,
	};
}

describe("WorkDiagnosticsDashboard", () => {
	it("shows a complete scope and verified lineage", () => {
		render(<WorkDiagnosticsDashboard t={t} data={view()} />);

		expect(screen.getByText("Complete")).toBeTruthy();
		expect(
			screen.getByText("No missing, conflicting or suspected historical work in this scope."),
		).toBeTruthy();
		expect(
			screen.getByText("1 of 1 employees have lineage verified from stored evidence."),
		).toBeTruthy();
	});

	it("shows record-level findings with treatment, provenance and evidence", () => {
		render(
			<WorkDiagnosticsDashboard
				t={t}
				data={view({
					report: report({
						completeness: {
							status: "incomplete",
							widenedTo: "employees",
							affectedEmployeeIds: [worker],
							blockingFindingIds: ["canonical_link_unresolved:p1:c1"],
						},
						findings: [
							{
								id: "canonical_link_unresolved:p1:c1",
								kind: "canonical_link_unresolved",
								shape: "conflicting",
								treatment: "investigation_required",
								blocking: true,
								employeeIds: [worker],
								workPeriodIds: ["p1"],
								timeRecordIds: ["c1"],
								entryIds: [],
								provenance: {
									state: "ambiguous",
									reason: "written_after_admission_without_receipt",
								},
								relevance: { level: "employee" },
								relevant: true,
								details: {},
							},
						],
					}),
				})}
			/>,
		);

		expect(screen.getByText("Incomplete")).toBeTruthy();
		expect(
			screen.getByText(
				"Dates could not be established, so affected employees are uncertain for every period.",
			),
		).toBeTruthy();
		const row = screen.getByText("Linked time record not found").closest("tr") as HTMLElement;
		expect(within(row).getByText("Investigation required")).toBeTruthy();
		expect(within(row).getByText("written_after_admission_without_receipt")).toBeTruthy();
		expect(within(row).getByText("Blocks completeness")).toBeTruthy();
		expect(within(row).getByText("p1")).toBeTruthy();
		expect(within(row).getByText("Wanda Worker").getAttribute("href")).toBe(
			`?employee=${worker}&month=`,
		);
	});

	it("surfaces append lineage issues, candidates and continuity interruptions", () => {
		render(
			<WorkDiagnosticsDashboard
				t={t}
				data={view({
					appendAssurance: [
						{
							employeeId: worker,
							report: assurance({
								lineage: {
									status: "review_required",
									issues: [
										{ kind: "ambiguous_predecessor", entryId: "e3", candidateIds: ["e1", "e2"] },
									],
								},
								continuity: {
									status: "interrupted",
									provenance: {
										admission: "verified_lineage",
										anchor: { id: "e1", hash: "h1" },
										admittedEntryCount: 1,
										admittedAt: "2026-07-01T00:00:00Z",
										tip: { id: "e2", hash: "h2" },
										entryCount: 2,
									},
									reasons: [{ kind: "admitted_history_changed" }],
								},
								assurance: {
									scope: "none",
									limitations: [{ code: "continuity_interrupted" }],
								},
							}),
						},
					],
				})}
			/>,
		);

		expect(
			screen.getByText("0 of 1 employees have lineage verified from stored evidence."),
		).toBeTruthy();
		expect(screen.getByText("ambiguous_predecessor")).toBeTruthy();
		expect(screen.getByText("e1, e2")).toBeTruthy();
		expect(screen.getByText("admitted_history_changed")).toBeTruthy();
		expect(screen.getByText("continuity_interrupted")).toBeTruthy();
	});
});
