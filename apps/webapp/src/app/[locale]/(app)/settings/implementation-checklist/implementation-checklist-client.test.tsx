/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const markComplete = vi.fn();
const markIncomplete = vi.fn();
const toastError = vi.fn();
const refresh = vi.fn();

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({ refresh }),
}));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", timeFormat: "24h" }),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, string | number>) => {
			if (!values) {
				return fallback;
			}

			return Object.entries(values).reduce(
				(text, [name, value]) =>
					text
						.replace(
							new RegExp(`\\{${name}, plural, one \\{([^}]*)\\} other \\{([^}]*)\\}\\}`),
							(_match, one: string, other: string) =>
								(value === 1 ? one : other).replaceAll("#", String(value)),
						)
						.replaceAll(`{${name}}`, String(value)),
				fallback,
			);
		},
	}),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({
		asChild,
		children,
		className,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
		if (asChild && isValidElement(children)) {
			const child = children as ReactElement<{ className?: string }>;
			return cloneElement(child, {
				...props,
				className: [child.props.className, className].filter(Boolean).join(" ") || undefined,
			});
		}

		return (
			<button className={className} {...props}>
				{children}
			</button>
		);
	},
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/progress", () => ({
	Progress: ({ value, ...props }: React.ComponentProps<"progress">) => (
		<progress value={value} {...props} />
	),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastError,
	},
}));

vi.mock("./actions", () => ({
	markImplementationChecklistItemComplete: markComplete,
	markImplementationChecklistItemIncomplete: markIncomplete,
}));

const readyGoLive = {
	readiness: { status: "ready", warnings: [] },
	checkedAt: "2026-06-15T10:05:00Z",
	timezone: "Europe/Berlin",
	memberCount: 3,
} as const;

const checklist = {
	completedCount: 1,
	totalCount: 2,
	goLive: readyGoLive,
	items: [
		{
			id: "organization-structure",
			title: "Organization structure",
			description: "Confirm members, teams, and responsibility boundaries before rollout.",
			helperText: "Manual review: Z8 cannot know whether your rollout structure is final.",
			actionLabel: "Review organization",
			href: "/settings/organizations",
			detector: "manual",
			canManualComplete: true,
			role: "manual-only",
			status: "not-set-up",
			completionSource: null,
			canToggleManualCompletion: true,
			goLive: null,
			countsTowardProgress: false,
		},
		{
			id: "holidays",
			title: "Holidays",
			description:
				"Configure public holidays and closing days used by absence and payroll workflows.",
			helperText: "Z8 checks for active holiday presets, assignments, or custom holidays.",
			actionLabel: "Configure holidays",
			href: "/settings/holidays",
			detector: "automatic",
			canManualComplete: false,
			role: "informational",
			status: "configured",
			completionSource: "automatic",
			canToggleManualCompletion: false,
			goLive: null,
			countsTowardProgress: true,
		},
	],
} as const;

function employee(index: number) {
	return {
		member: {
			kind: "employee",
			employeeId: `employee-${index}`,
			primaryTeamId: "team-warehouse",
			displayName: `Picker ${index}`,
		},
	} as const;
}

const failingWorkPolicyItem = {
	id: "work-policies",
	title: "Work policies",
	description: "Set schedules, working time rules, and policy assignments for the organization.",
	helperText:
		"Z8 checks that every employee on the current roster has an effective work policy today.",
	actionLabel: "Configure work policies",
	href: "/settings/work-policies",
	detector: "go-live",
	canManualComplete: false,
	role: "mandatory",
	status: "needs-attention",
	completionSource: null,
	canToggleManualCompletion: false,
	countsTowardProgress: false,
	goLive: {
		checkId: "work-policy",
		itemId: "work-policies",
		severity: "mandatory",
		checkedMemberCount: 14,
		outcome: "failed",
		configured: true,
		warnings: [],
		notes: [],
		failures: [
			{
				cause: "work-policy:team:team-warehouse",
				reason: {
					key: "settings.implementationChecklist.goLive.workPolicy.teamWithoutPolicy",
					fallback: "Team {team} has no work policy: {count} employees",
					params: { team: "Warehouse", count: 12 },
				},
				members: Array.from({ length: 12 }, (_, index) => employee(index + 1)),
				fix: {
					href: "/settings/work-policies?tab=work&view=assignments",
					label: {
						key: "settings.implementationChecklist.goLive.workPolicy.fix",
						fallback: "Assign work policies",
					},
				},
			},
			{
				cause: null,
				reason: { key: "settings.implementationChecklist.test.individual", fallback: "Other" },
				members: [
					{
						member: {
							kind: "invitee",
							draftId: "draft-1",
							email: "new@example.com",
							teamId: null,
							displayName: "New Hire",
						},
						detail: {
							key: "settings.implementationChecklist.test.detail",
							fallback: "No team yet",
						},
					},
				],
				fix: null,
			},
		],
	},
} as const;

describe("ImplementationChecklistClient", () => {
	beforeEach(() => {
		markComplete.mockReset();
		markIncomplete.mockReset();
		toastError.mockReset();
	});

	it("renders checklist summary, task links, status, and manual completion controls", async () => {
		const { ImplementationChecklistClient } = await import("./implementation-checklist-client");

		render(<ImplementationChecklistClient checklist={checklist} />);

		expect(screen.getByText("Customer implementation")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Implementation checklist", level: 1 }),
		).toBeTruthy();
		expect(screen.getByText(/Finish the setup steps before inviting your full team/i)).toBeTruthy();
		expect(screen.getByText("1 of 2 complete")).toBeTruthy();
		expect(screen.getByText("50% complete")).toBeTruthy();
		expect(screen.getByLabelText("Implementation checklist progress")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Review organization" }).getAttribute("href")).toBe(
			"/settings/organizations",
		);
		expect(screen.getByRole("link", { name: "Configure holidays" }).getAttribute("href")).toBe(
			"/settings/holidays",
		);
		expect(screen.getByRole("button", { name: "Mark complete" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Mark incomplete" })).toBeNull();
		expect(screen.getAllByText("Not set up").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Configured").length).toBeGreaterThan(0);
	});

	it("shows go-live readiness with when the checks ran", async () => {
		const { ImplementationChecklistClient } = await import("./implementation-checklist-client");

		render(<ImplementationChecklistClient checklist={checklist} />);

		expect(screen.getByRole("heading", { name: "Go-live readiness" })).toBeTruthy();
		expect(screen.getByText("Ready to go live")).toBeTruthy();
		expect(screen.getByText("Checked Jun 15, 2026, 10:05")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Retry checks" })).toBeNull();
	});

	it("shows how many employees keep the organization from going live", async () => {
		const { ImplementationChecklistClient } = await import("./implementation-checklist-client");

		render(
			<ImplementationChecklistClient
				checklist={{
					...checklist,
					goLive: {
						...readyGoLive,
						readiness: { status: "not-ready", affectedMemberCount: 13, warnings: [] },
					},
					items: [failingWorkPolicyItem],
				}}
			/>,
		);

		expect(screen.getByText("Not ready: 13 employees need attention")).toBeTruthy();
		expect(screen.getAllByText("Needs attention").length).toBeGreaterThan(0);
	});

	it("offers a retry and never a pass when a check is unavailable", async () => {
		const { ImplementationChecklistClient } = await import("./implementation-checklist-client");

		render(
			<ImplementationChecklistClient
				checklist={{
					...checklist,
					goLive: { ...readyGoLive, readiness: { status: "unavailable" }, memberCount: null },
				}}
			/>,
		);

		expect(screen.queryByText("Ready to go live")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry checks" }));
		await waitFor(() => expect(refresh).toHaveBeenCalled());
	});

	it("lists failures by cause with a paged member list and the fix link", async () => {
		const { ImplementationChecklistClient } = await import("./implementation-checklist-client");

		render(
			<ImplementationChecklistClient
				checklist={{ ...checklist, items: [failingWorkPolicyItem] }}
			/>,
		);

		expect(screen.getByText("Team Warehouse has no work policy: 12 employees")).toBeTruthy();
		expect(screen.getByText("Picker 1")).toBeTruthy();
		expect(screen.getByText("Picker 10")).toBeTruthy();
		expect(screen.queryByText("Picker 11")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Next page" }));
		expect(screen.getByText("Picker 11")).toBeTruthy();
		expect(screen.queryByText("Picker 1")).toBeNull();
		expect(screen.getByRole("link", { name: "Assign work policies" }).getAttribute("href")).toBe(
			"/settings/work-policies?tab=work&view=assignments",
		);
		expect(screen.getByText("New Hire")).toBeTruthy();
		expect(screen.getByText("Invited")).toBeTruthy();
		expect(screen.getByText("No team yet")).toBeTruthy();
		expect(screen.getAllByRole("link", { name: "Assign work policies" })).toHaveLength(1);
	});

	it("marks manual items complete and shows an error toast on failure", async () => {
		markComplete.mockResolvedValue({ success: false, error: "Unable to update checklist" });
		const { ImplementationChecklistClient } = await import("./implementation-checklist-client");

		render(<ImplementationChecklistClient checklist={checklist} />);
		fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));

		await waitFor(() => {
			expect(markComplete).toHaveBeenCalledWith("organization-structure");
			expect(toastError).toHaveBeenCalledWith("Unable to update checklist");
		});
	});
});
