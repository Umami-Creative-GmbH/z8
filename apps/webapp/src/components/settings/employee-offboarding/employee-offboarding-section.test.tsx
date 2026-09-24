/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeOffboardingView } from "@/lib/employee-lifecycle/view-types";

const hook = vi.hoisted(() => ({
	useEmployeeOffboarding: vi.fn(),
	scheduleDeparture: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/app/[locale]/(app)/settings/teams/actions", () => ({
	listTeams: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));

vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		name,
		value,
		onChange,
	}: {
		name: string;
		value?: string;
		onChange: (value: string) => void;
	}) => (
		<input
			aria-label={name}
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));

vi.mock("@/lib/query/use-employee-offboarding", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/query/use-employee-offboarding")>()),
	useEmployeeOffboarding: hook.useEmployeeOffboarding,
	useDeparturePreview: () => ({ data: undefined, isFetching: false, error: null }),
}));

import { EmployeeOffboardingSection } from "./employee-offboarding-section";

const employeeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const employeeB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function activeView(employeeId: string): EmployeeOffboardingView {
	return {
		employeeId,
		organizationId: "org-1",
		employmentPeriodId: "period-1",
		state: "active",
		departure: null,
		previousEmploymentPeriodId: null,
		membershipApproved: true,
		followUp: { pending: 0, failed: 0, openReviews: 0 },
		failedTasks: [],
		reviews: [],
		futureWork: { shifts: 0, absences: 0, employmentTerms: 0 },
		capabilities: {
			schedule: true,
			cancel: false,
			offboardNow: true,
			rehire: false,
			resolve: false,
		},
	};
}

function section(employeeId: string) {
	return (
		<QueryClientProvider client={new QueryClient()}>
			<EmployeeOffboardingSection
				organizationId="org-1"
				employeeId={employeeId}
				highlightedReviewId={null}
				managers={[]}
				workPolicies={[]}
			/>
		</QueryClientProvider>
	);
}

describe("EmployeeOffboardingSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hook.scheduleDeparture.mockResolvedValue({ success: true, data: {} });
		hook.useEmployeeOffboarding.mockImplementation(({ employeeId }: { employeeId: string }) => ({
			view: activeView(employeeId),
			isLoading: false,
			isMutating: false,
			scheduleDeparture: hook.scheduleDeparture,
			offboardNow: vi.fn(),
			cancelDeparture: vi.fn(),
			rehire: vi.fn(),
			resolveReview: vi.fn(),
			retryTask: vi.fn(),
			assignReplacement: vi.fn(),
		}));
	});

	it("stops offering the open form once the cutoff passes and the view refreshes", async () => {
		const user = userEvent.setup();
		const scheduled: EmployeeOffboardingView = {
			...activeView(employeeA),
			state: "scheduled",
			departure: {
				id: "22222222-2222-4222-8222-222222222222",
				revision: 1,
				mode: "scheduled",
				lastWorkingDay: "2026-09-30",
				cutoff: "2026-09-30T22:00:00Z",
				timezone: "Europe/Berlin",
				replacementEmployeeId: null,
				blockedReason: null,
			},
			capabilities: {
				schedule: true,
				cancel: true,
				offboardNow: true,
				rehire: false,
				resolve: false,
			},
		};
		const offboarded: EmployeeOffboardingView = {
			...scheduled,
			state: "offboarded",
			capabilities: {
				schedule: false,
				cancel: false,
				offboardNow: false,
				rehire: true,
				resolve: false,
			},
		};
		let current = scheduled;
		hook.useEmployeeOffboarding.mockImplementation(() => ({
			view: current,
			isLoading: false,
			isMutating: false,
			scheduleDeparture: hook.scheduleDeparture,
			offboardNow: vi.fn(),
			cancelDeparture: vi.fn(),
			rehire: vi.fn(),
			resolveReview: vi.fn(),
			retryTask: vi.fn(),
			assignReplacement: vi.fn(),
		}));
		// The cutoff passed while the form was open: the server refuses the edit.
		hook.scheduleDeparture.mockImplementation(async () => {
			current = offboarded;
			return {
				success: false,
				error: "This departure has already taken effect. Rehire the employee to restore access.",
			};
		});
		const { rerender } = render(section(employeeA));

		await user.click(screen.getByRole("button", { name: "Edit departure" }));
		await user.click(await screen.findByRole("button", { name: "Save departure" }));
		await waitFor(() => expect(hook.scheduleDeparture).toHaveBeenCalledTimes(1));
		// The settled command refreshes the view.
		rerender(section(employeeA));

		expect(screen.queryByRole("button", { name: "Save departure" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Offboard now" })).toBeNull();
		expect(screen.getByText(/The employment status changed while this form was open/)).toBeTruthy();
		expect(screen.getByTestId("departure-state").textContent).toBe("Departure effective");
		expect(hook.scheduleDeparture).toHaveBeenCalledTimes(1);
	});

	it("never submits an open form for a previous employee after navigating to another", async () => {
		const user = userEvent.setup();
		const { rerender } = render(section(employeeA));

		await user.click(screen.getByRole("button", { name: "Schedule departure" }));
		await user.type(await screen.findByLabelText("lastWorkingDay"), "2026-09-30");
		rerender(section(employeeB));

		// The panel belongs to the new target and starts empty.
		expect((screen.getByLabelText("lastWorkingDay") as HTMLInputElement).value).toBe("");
		await user.type(screen.getByLabelText("lastWorkingDay"), "2026-10-15");
		await user.click(
			screen.getAllByRole("button", { name: "Schedule departure" }).at(-1) as HTMLElement,
		);

		await waitFor(() => expect(hook.scheduleDeparture).toHaveBeenCalledTimes(1));
		expect(hook.scheduleDeparture).toHaveBeenCalledWith(
			expect.objectContaining({ employeeId: employeeB, lastWorkingDay: "2026-10-15" }),
		);
	});
});
