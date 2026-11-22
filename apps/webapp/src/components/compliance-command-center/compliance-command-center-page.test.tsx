/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComplianceCommandCenterData } from "@/lib/compliance-command-center/types";
import { buildComplianceCommandCenterData } from "@/lib/compliance-command-center/view-model";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import {
	ComplianceCommandCenterPage,
	CompliancePageLoading,
} from "./compliance-command-center-page";

const refresh = vi.fn();
const tolgeeTranslations = vi.hoisted(() => new Map<string, string>());

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			fallback: string,
			params?: Record<string, string | number>,
		) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) =>
					message.replaceAll(`{${key}}`, String(value)),
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
	it("announces loading without exposing findings or inventing zero counts", () => {
		render(<CompliancePageLoading />);
		expect(
			screen
				.getByRole("status", { name: "Loading compliance signals" })
				.getAttribute("aria-busy"),
		).toBe("true");
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"Compliance",
		);
		expect(screen.queryByText(/Rest-period violations:/)).toBeNull();
	});
	beforeEach(() => {
		vi.useFakeTimers();
		refresh.mockReset();
		tolgeeTranslations.clear();
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});

	it("leads with ordered actionable sources and puts unavailable coverage after critical events", () => {
		const data: ComplianceCommandCenterData = {
			refreshedAt: "2026-04-11T10:00:00.000Z",
			summary: {
				status: "critical",
				headline: "Critical compliance risks need attention",
				topRiskKeys: ["workforceCompliance"],
				refreshedAt: "2026-04-11T10:00:00.000Z",
			},
			sections: [
				{
					key: "auditEvidence",
					status: "unavailable",
					headline: "Signal temporarily unavailable",
					facts: ["Audit evidence could not be loaded."],
					updatedAt: null,
					primaryLink: {
						label: "Open Audit Export",
						href: "/settings/audit-export",
					},
				},
				{
					key: "accessControls",
					status: "warning",
					headline: "Recent control changes were detected",
					facts: ["Recent sensitive events: 2"],
					updatedAt: null,
					primaryLink: {
						label: "Open Audit Log",
						href: "/settings/audit-export?tab=activity",
					},
				},
				{
					key: "workforceCompliance",
					status: "critical",
					headline: "Workforce policy violations need review",
					facts: [
						"Rest-period violations: 3",
						"General policy violations: 1",
						"Overtime violations: 2",
						"Pending exceptions: 4",
					],
					updatedAt: null,
					primaryLink: {
						label: "Open Compliance Settings",
						href: "/settings/compliance",
					},
				},
			],
			recentCriticalEvents: [
				{
					id: "finding",
					sectionKey: "workforceCompliance",
					severity: "critical",
					title: "Workforce compliance findings detected",
					description: "Recorded findings",
					occurredAt: "2026-04-11T09:30:00.000Z",
					primaryLink: {
						label: "Inspect compliance",
						href: "/settings/compliance",
					},
				},
			],
			coverageNotes: [
				"Workforce compliance uses the last 7 days of work-policy violations and pending exception requests.",
			],
		};
		render(
			<>
				<header>
					{appPageOwnsHeading("/en/compliance") ? (
						<span>Compliance</span>
					) : (
						<h1>Compliance</h1>
					)}
				</header>
				<ComplianceCommandCenterPage data={data} />
			</>,
		);
		expect(
			screen
				.getAllByRole("heading", { level: 1 })
				.map((node) => node.textContent),
		).toEqual(["Compliance"]);
		expect(
			screen
				.getAllByRole("heading", { level: 3 })
				.map((node) => node.textContent),
		).toEqual(["Workforce compliance", "Access controls", "Audit evidence"]);
		const events = screen.getByRole("heading", {
			name: "Recent Critical Events",
		});
		const coverage = screen.getByRole("heading", { name: "Coverage" });
		expect(
			events.compareDocumentPosition(coverage) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			coverage.compareDocumentPosition(
				screen.getByText("Audit evidence could not be loaded."),
			) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		for (const fact of [
			"Rest-period violations: 3",
			"General policy violations: 1",
			"Overtime violations: 2",
			"Pending exceptions: 4",
			"Recent sensitive events: 2",
		])
			expect(screen.getByText(fact)).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open Compliance Settings" })
				.getAttribute("href"),
		).toBe("/settings/compliance");
		expect(
			screen
				.getByRole("link", { name: "Open Audit Export" })
				.getAttribute("href"),
		).toBe("/settings/audit-export");
		expect(
			screen.getByRole("link", { name: "Open Audit Log" }).getAttribute("href"),
		).toBe("/settings/audit-export?tab=activity");
		expect(screen.getByText(/does not reevaluate/)).toBeTruthy();
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
							primaryLink: {
								label: "Open Audit Export",
								href: "/settings/audit-export",
							},
						},
						{
							key: "accessControls",
							status: "unavailable",
							headline: "Signal temporarily unavailable",
							facts: ["Access-control events could not be loaded."],
							updatedAt: "2026-04-11T10:00:00.000Z",
							primaryLink: {
								label: "Open Audit Log",
								href: "/settings/audit-export?tab=activity",
							},
						},
					],
					recentCriticalEvents: [
						{
							id: "event_1",
							sectionKey: "accessControls",
							severity: "critical",
							title: "Admin role changed outside scheduled review",
							description:
								"A privileged role change occurred without an approval note.",
							occurredAt: "2026-04-11T09:30:00.000Z",
							primaryLink: {
								label: "Review Audit Log",
								href: "/settings/audit-export?tab=activity",
							},
						},
					],
					coverageNotes: [
						"Access controls only summarize logged audit events.",
					],
				}}
			/>,
		);

		expect(screen.getByText("Compliance signals need review")).toBeTruthy();
		expect(
			screen.getByText("Audit evidence signals look healthy"),
		).toBeTruthy();
		expect(
			screen.getByText("Access-control events could not be loaded."),
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Recent Critical Events" }),
		).toBeTruthy();
		expect(
			screen.getByText("Admin role changed outside scheduled review"),
		).toBeTruthy();
		expect(
			screen.getByText("Access controls only summarize logged audit events."),
		).toBeTruthy();
	});

	it("distinguishes all-clear events from partial and unavailable sources during refresh recovery", () => {
		const makeData = (unavailable: boolean, allUnavailable = false) =>
			buildComplianceCommandCenterData({
				refreshedAt: "2026-04-11T10:00:00.000Z",
				sections: [
					{
						key: "workforceCompliance",
						status: allUnavailable ? "unavailable" : "healthy",
						headline: "Workforce signals",
						facts: [
							allUnavailable
								? "Workforce signals could not be loaded."
								: "Rest-period violations: 0",
						],
						updatedAt: null,
						primaryLink: {
							label: "Open Compliance Settings",
							href: "/settings/compliance",
						},
					},
					{
						key: "accessControls",
						status: unavailable ? "unavailable" : "healthy",
						headline: "Access signals",
						facts: [
							unavailable
								? "Access-control events could not be loaded."
								: "Recent sensitive events: 0",
						],
						updatedAt: null,
						primaryLink: {
							label: "Open Audit Log",
							href: "/settings/audit-export?tab=activity",
						},
					},
				],
				recentCriticalEvents: [],
				coverageNotes: [],
			});
		const { rerender, unmount } = render(
			<ComplianceCommandCenterPage data={makeData(true)} />,
		);
		expect(
			screen.queryByText("No recent critical events were detected."),
		).toBeNull();
		expect(
			screen.getByText(
				"Recent events are limited to available sources. Some signals could not be loaded.",
			),
		).toBeTruthy();
		expect(
			screen.getByText("Some compliance signals are unavailable"),
		).toBeTruthy();
		const settingsLink = screen.getByRole("link", {
			name: "Open Compliance Settings",
		});
		vi.advanceTimersByTime(60_000);
		rerender(<ComplianceCommandCenterPage data={makeData(false)} />);
		expect(screen.getByRole("link", { name: "Open Compliance Settings" })).toBe(
			settingsLink,
		);
		expect(
			screen.getByText("No active issues detected in monitored signals"),
		).toBeTruthy();
		expect(
			screen.getByText("No recent critical events were detected."),
		).toBeTruthy();
		vi.advanceTimersByTime(60_000);
		expect(refresh).toHaveBeenCalledTimes(1);
		rerender(<ComplianceCommandCenterPage data={makeData(true, true)} />);
		expect(
			screen.getByText(
				"Recent events could not be confirmed because the signal sources are unavailable.",
			),
		).toBeTruthy();
		expect(
			screen.queryByText("No recent critical events were detected."),
		).toBeNull();
		unmount();
		vi.advanceTimersByTime(120_000);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("renders translated command-center chrome and interpolated data", () => {
		tolgeeTranslations.set(
			"compliance.commandCenter.overview",
			"Compliance-Überblick",
		);
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
		expect(
			screen.getByRole("heading", { name: "Aktuelle kritische Ereignisse" }),
		).toBeTruthy();
		expect(
			screen.getByText("Keine kritischen Ereignisse erkannt."),
		).toBeTruthy();
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
