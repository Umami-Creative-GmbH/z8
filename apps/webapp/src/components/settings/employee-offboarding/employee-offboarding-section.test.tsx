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
