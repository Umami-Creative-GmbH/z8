/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComplianceCommandCenterPage } from "./compliance-command-center-page";

const refresh = vi.fn();
const tolgeeTranslations = vi.hoisted(() => new Map<string, string>());

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
				tolgeeTranslations.get(_key) ?? fallback,
			),
	}),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh }),
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

describe("ComplianceCommandCenterPage", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		refresh.mockReset();
		tolgeeTranslations.clear();
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});

	it("renders cards, events, and coverage notes", () => {
		render(
			<ComplianceCommandCenterPage
				data={{
					refreshedAt: "2026-04-11T10:00:00.000Z",
					summary: {
						status: "warning",
						headline: "Compliance signals need review",
						topRiskKeys: ["workforceCompliance"],
						refreshedAt: "2026-04-11T10:00:00.000Z",
					},
					sections: [
						{
							key: "auditEvidence",
							status: "healthy",
							headline: "Audit evidence signals look healthy",
							facts: ["Recent failed audit-pack jobs: 0"],
							updatedAt: "2026-04-11T10:00:00.000Z",
							primaryLink: { label: "Open Audit Export", href: "/settings/audit-export" },
						},
						{
							key: "accessControls",
							status: "unavailable",
							headline: "Signal temporarily unavailable",
							facts: ["Access-control events could not be loaded."],
							updatedAt: "2026-04-11T10:00:00.000Z",
							primaryLink: { label: "Open Audit Log", href: "/settings/enterprise/audit-log" },
						},
					],
					recentCriticalEvents: [
						{
							id: "event_1",
							sectionKey: "accessControls",
							severity: "critical",
							title: "Admin role changed outside scheduled review",
							description: "A privileged role change occurred without an approval note.",
							occurredAt: "2026-04-11T09:30:00.000Z",
							primaryLink: {
								label: "Review Audit Log",
								href: "/settings/enterprise/audit-log",
							},
						},
					],
					coverageNotes: ["Access controls only summarize logged audit events."],
				}}
			/>,
		);

		expect(screen.getByText("Compliance signals need review")).toBeTruthy();
		expect(screen.getByText("Audit evidence signals look healthy")).toBeTruthy();
		expect(screen.getByText("Access-control events could not be loaded.")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Recent Critical Events" })).toBeTruthy();
		expect(screen.getByText("Admin role changed outside scheduled review")).toBeTruthy();
		expect(screen.getByText("Access controls only summarize logged audit events.")).toBeTruthy();
	});

	it("renders translated command-center chrome and interpolated data", () => {
		tolgeeTranslations.set("compliance.commandCenter.overview", "Compliance-Überblick");
		tolgeeTranslations.set("compliance.commandCenter.status.healthy", "stabil");
		tolgeeTranslations.set(
			"compliance.commandCenter.recentEvents.title",
			"Aktuelle kritische Ereignisse",
		);
		tolgeeTranslations.set(
			"compliance.commandCenter.recentEvents.empty",
			"Keine kritischen Ereignisse erkannt.",
		);
		tolgeeTranslations.set(
			"compliance.commandCenter.footer.lastRefreshed",
			"Zuletzt aktualisiert: {time}",
		);

		render(
			<ComplianceCommandCenterPage
				data={{
					refreshedAt: "2026-04-11T10:00:00.000Z",
					summary: {
						status: "healthy",
						headline: "No active issues detected in monitored signals",
						topRiskKeys: [],
						refreshedAt: "2026-04-11T10:00:00.000Z",
					},
					sections: [],
					recentCriticalEvents: [],
					coverageNotes: [],
				}}
			/>,
		);

		expect(screen.getByText("Compliance-Überblick")).toBeTruthy();
		expect(screen.getByText("stabil")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Aktuelle kritische Ereignisse" })).toBeTruthy();
		expect(screen.getByText("Keine kritischen Ereignisse erkannt.")).toBeTruthy();
		expect(screen.getByText(/Zuletzt aktualisiert:/)).toBeTruthy();
	});

	it("refreshes the route every two minutes to keep critical signals fresher", () => {
		render(
			<ComplianceCommandCenterPage
				data={{
					refreshedAt: "2026-04-11T10:00:00.000Z",
					summary: {
						status: "healthy",
						headline: "No active issues detected in monitored signals",
						topRiskKeys: [],
						refreshedAt: "2026-04-11T10:00:00.000Z",
					},
					sections: [],
					recentCriticalEvents: [],
					coverageNotes: [],
				}}
			/>,
		);

		vi.advanceTimersByTime(120_000);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
