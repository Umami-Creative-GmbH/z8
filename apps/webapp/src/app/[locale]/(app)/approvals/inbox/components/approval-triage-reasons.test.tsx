/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { summaryField } from "@/components/approvals/use-approval-inbox-text";
import { loadComplianceExceptionInboxItems } from "@/lib/approvals/inbox/compliance-exception-inbox";
import type { CanonicalInboxReadDatabase } from "@/lib/approvals/inbox/canonical-inbox-read";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { ApprovalTriageReasons } from "./approval-triage-reasons";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/notifications/compliance-triggers", () => ({
	onComplianceExceptionApproved: vi.fn(),
	onComplianceExceptionRejected: vi.fn(),
}));
vi.mock("next-intl", () => ({ useLocale: () => "de" }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string, params?: Record<string, unknown>) => {
			const translations: Record<string, string> = {
				"approvals:triage.reasons.needs_review": "Manuelle Prüfung erforderlich.",
				"approvals:triage.facts.originalAt": "Ursprünglicher Zeitpunkt",
				"approvals:triage.facts.originalLocalDate": "Ursprüngliches Datum",
				"approvals:triage.facts.endpoint": "Zeitpunkt",
				"approvals:triage.values.clock_in": "Einstempeln",
				"approvals:triage.facts.limitation": "Prüfgrenze",
				"approvals:triage.values.endpoint_capture_unverified":
					"Erfasster Zeitpunkt nicht bestätigt",
			};
			return (translations[key] ?? fallback).replace(
				/\{(\w+)\}/g,
				(match, name) =>
					params?.[name] === undefined ? match : String(params[name]),
			);
		},
	}),
}));
it("localizes domain facts and captured local endpoints while hiding internal identifiers and codes", () => {
	render(
		<ApprovalTriageReasons
			triage={{
				priority: "normal",
				riskLevel: "high",
				riskReasons: ["event_local_date_changed"],
				fastLaneGroup: null,
				isPayrollRelevant: false,
				explanation: "",
				reasons: [
					{
						code: "event_local_date_changed",
						riskLevel: "high",
						text: {
							key: "approvals:triage.test.changed",
							fallback: "Date changed.",
						},
						facts: {
							endpoint: "clock_in",
							originalAt: "2026-10-19T07:00:00Z",
							originalOffsetMinutes: 120,
							originalLocalDate: "2026-10-19",
							limitation: "endpoint_capture_unverified",
							sourceId: "private-source-123",
							subareaId: "internal-area-456",
							originalValue: "internal-category-789",
						},
					},
				],
			}}
		/>,
	);
	expect(screen.getByText("Zeitpunkt: Einstempeln")).toBeTruthy();
	expect(
		screen.getByText(/Ursprünglicher Zeitpunkt:.*09:00.*UTC\+02:00/),
	).toBeTruthy();
	expect(screen.getByText("Ursprüngliches Datum: 19.10.2026")).toBeTruthy();
	expect(
		screen.getByText("Prüfgrenze: Erfasster Zeitpunkt nicht bestätigt"),
	).toBeTruthy();
	expect(document.body.textContent).not.toMatch(
		/private-source|internal-area|internal-category|clock_in|endpoint_capture_unverified|originalLocalDate/,
	);
});

it("explains a compliance exception's review in the reader's language, and shows its reason as written (#1977)", async () => {
	const database = {
		execute: async () => ({
			rows: [
				{
					id: "6f9d3c1e-0000-4000-8000-000000000001",
					organizationId: "org-1",
					employeeId: "employee-1",
					exceptionType: "rest_period",
					status: "pending",
					reason: "Inventur läuft länger",
					plannedDurationMinutes: 90,
					validFrom: "2026-03-10T08:00:00Z",
					validUntil: "2026-03-11T08:00:00Z",
					createdAt: "2026-03-10T08:00:00Z",
					approvedAt: null,
					rejectedAt: null,
					rejectionReason: null,
					teamId: null,
					userName: "Avery Employee",
					userEmail: "avery@example.com",
					userImage: null,
					approverName: null,
					totalCount: 1,
				},
			],
		}),
	} as unknown as CanonicalInboxReadDatabase;
	const [item] = await loadComplianceExceptionInboxItems({
		organizationId: "org-1",
		scope: { kind: "organization" },
		status: "pending",
		now: parseInstant("2026-03-10T12:00:00Z"),
		database,
	});
	if (!item) throw new Error("expected the exception");

	render(<ApprovalTriageReasons triage={item.triage} />);

	expect(screen.getByText("Manuelle Prüfung erforderlich.")).toBeTruthy();
	expect(document.body.textContent).not.toContain("Needs manual review.");
	expect(summaryField(item.summary, "detail")).toBe("Inventur läuft länger");
});
