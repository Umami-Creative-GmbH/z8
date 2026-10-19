/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApprovalTriageReasons } from "./approval-triage-reasons";

vi.mock("next-intl", () => ({ useLocale: () => "de" }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string, params?: Record<string, unknown>) => {
			const translations: Record<string, string> = {
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
