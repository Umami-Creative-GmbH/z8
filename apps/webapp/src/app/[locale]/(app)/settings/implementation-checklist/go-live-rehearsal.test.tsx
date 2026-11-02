/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoLiveRehearsal } from "@/lib/implementation-checklist/go-live/rehearsal-types";

const rehearse = vi.hoisted(() => vi.fn());

vi.mock("./go-live-rehearsal-actions", () => ({ rehearseGoLiveMemberAction: rehearse }));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", timeFormat: "24h" }),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, string | number>) =>
			Object.entries(values ?? {}).reduce(
				(text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("@/components/ui/sheet", () => ({
	Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <div role="dialog">{children}</div> : null,
	SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/searchable-select", () => ({
	SearchableSelect: ({
		options,
		value,
		onValueChange,
		"aria-label": ariaLabel,
	}: {
		options: { code: string; name: string }[];
		value: string;
		onValueChange: (value: string) => void;
		"aria-label"?: string;
	}) => (
		<select
			aria-label={ariaLabel}
			onChange={(event) => onValueChange(event.target.value)}
			value={value}
		>
			<option value="" />
			{options.map((option) => (
				<option key={option.code} value={option.code}>
					{option.name}
				</option>
			))}
		</select>
	),
}));

import { GoLiveFailureGroupView } from "./go-live-check-panel";
import { GoLiveRehearsalPicker, GoLiveRehearsalProvider } from "./go-live-rehearsal";

const sam = {
	kind: "employee" as const,
	employeeId: "e-sam",
	primaryTeamId: "t-floor",
	displayName: "Sam Subject",
};
const candidates = [{ key: "employee:e-sam", displayName: "Sam Subject", invited: false }];

const rehearsal: GoLiveRehearsal = {
	member: sam,
	asOf: { instant: "2026-06-15T10:00:00Z", timezone: "Europe/Berlin", today: "2026-06-15" },
	workPolicy: {
		status: "resolved",
		policyId: "p-1",
		policyName: "Floor hours",
		assignmentType: "team",
		assignedVia: "Floor",
		schedule: { cycle: "weekly", hours: 40, workingDays: ["monday", "friday"] },
	},
	approvals: {
		kinds: [
			{
				kind: "absence",
				label: { key: "kind", fallback: "Absence requests" },
				status: "routed",
				reason: null,
				fix: null,
				variants: [
					{
						label: null,
						status: "routed",
						reason: null,
						route: {
							path: "canonical",
							policyName: null,
							stages: [
								{
									sequence: 1,
									label: "Approval",
									approverType: "specific_employee",
									fallbackBehavior: "fail",
									activates: "at_submission",
									resolution: "human",
									approvers: [{ employeeId: "e-mia", displayName: "Mia Manager" }],
									viaFallback: false,
									standsInFor: { employeeId: "e-nora", displayName: "Nora Named" },
								},
							],
						},
					},
				],
			},
			{
				kind: "time_correction",
				label: { key: "kind", fallback: "Time corrections" },
				status: "skipped",
				reason: { key: "skip", fallback: "Their change policy is in trust mode." },
				fix: null,
				variants: [],
			},
			{
				kind: "travel_expense",
				label: { key: "kind", fallback: "Expense reports" },
				status: "unroutable",
				reason: {
					key: "unroutable",
					fallback: "Approval policy Large finds no approver for them.",
				},
				fix: {
					href: "/settings/approval-policies",
					label: { key: "fix", fallback: "Review approval policies" },
				},
				variants: [],
			},
		],
		offKinds: ["shift_request"],
	},
	payroll: null,
};

describe("go-live rehearsal", () => {
	beforeEach(() => {
		rehearse.mockReset();
	});

	it("rehearses the picked member and shows policy, approvers per kind and payroll", async () => {
		rehearse.mockResolvedValue({ success: true, data: rehearsal });
		render(
			<GoLiveRehearsalProvider candidates={candidates}>
				<GoLiveRehearsalPicker />
			</GoLiveRehearsalProvider>,
		);

		fireEvent.change(screen.getByLabelText("Person"), { target: { value: "employee:e-sam" } });
		fireEvent.click(screen.getByRole("button", { name: "Rehearse" }));

		expect(rehearse).toHaveBeenCalledWith("employee:e-sam");
		const sheet = await screen.findByRole("dialog");
		await waitFor(() => expect(sheet.textContent).toContain("Floor hours"));
		expect(sheet.textContent).toContain(
			"What Z8 would do for Sam Subject today. Nothing is saved or sent.",
		);
		expect(sheet.textContent).toContain("Mon, Fri");
		expect(sheet.textContent).toContain("Mia Manager");
		expect(sheet.textContent).toContain("Stands in for Nora Named, who has left.");
		expect(sheet.textContent).toContain("No approval needed");
		expect(sheet.textContent).toContain("Their change policy is in trust mode.");
		expect(sheet.textContent).toContain("Can't be routed");
		expect(
			screen.getByRole("link", { name: "Review approval policies" }).getAttribute("href"),
		).toBe("/settings/approval-policies");
		expect(sheet.textContent).toContain("no active payroll export target");
		expect(sheet.textContent).toContain("Shifts are off");
	});

	it("opens from a checked member in a failure list", async () => {
		rehearse.mockResolvedValue({ success: false, error: "unavailable" });
		render(
			<GoLiveRehearsalProvider candidates={candidates}>
				<GoLiveFailureGroupView
					group={{
						cause: "work-policy:no-team",
						reason: { key: "reason", fallback: "No organization work policy" },
						members: [{ member: sam }],
						fix: null,
					}}
				/>
			</GoLiveRehearsalProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Rehearse go-live for Sam Subject" }));

		expect(rehearse).toHaveBeenCalledWith("employee:e-sam");
		expect(await screen.findByText("The rehearsal could not be completed.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(rehearse).toHaveBeenCalledTimes(2);
	});

	it("offers no rehearsal outside the checklist's provider or for someone not checked", () => {
		render(
			<GoLiveRehearsalProvider candidates={[]}>
				<GoLiveFailureGroupView
					group={{
						cause: null,
						reason: { key: "reason", fallback: "Reason" },
						members: [{ member: sam }],
						fix: null,
					}}
				/>
			</GoLiveRehearsalProvider>,
		);

		expect(screen.queryByRole("button", { name: /Rehearse/ })).toBeNull();
	});
});
