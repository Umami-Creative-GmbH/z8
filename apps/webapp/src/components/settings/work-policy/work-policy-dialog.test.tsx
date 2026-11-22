/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	updateWorkPolicy,
	type WorkPolicyWithDetails,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { WorkPolicyDialog } from "./work-policy-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match),
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/app/[locale]/(app)/settings/work-policies/actions", () => ({
	createWorkPolicy: vi.fn(),
	updateWorkPolicy: vi.fn(),
	publishWorkPolicyVersion: vi.fn(),
}));

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	Element.prototype.hasPointerCapture = vi.fn(() => false);
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
	Element.prototype.scrollIntoView = vi.fn();
});

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

const editablePolicy = {
	id: "policy-1",
	organizationId: "org-1",
	name: "Retail 38h",
	description: "Retail operations policy",
	isDefault: false,
	isActive: true,
	scheduleEnabled: true,
	regulationEnabled: true,
	presenceEnabled: false,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	schedule: {
		id: "schedule-1",
		policyId: "policy-1",
		scheduleCycle: "weekly",
		scheduleType: "simple",
		workingDaysPreset: "weekdays",
		hoursPerCycle: "38",
		homeOfficeDaysPerCycle: 2,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		days: [],
	},
	regulation: {
		id: "regulation-1",
		policyId: "policy-1",
		maxDailyMinutes: 480,
		maxWeeklyMinutes: 2280,
		maxUninterruptedMinutes: 360,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		breakRules: [],
	},
	presence: null,
} as unknown as WorkPolicyWithDetails;

describe("WorkPolicyDialog", () => {
	it("populates form fields when opened for editing a work policy", async () => {
		const { rerender } = renderWithQueryClient(
			<WorkPolicyDialog
				open={false}
				onOpenChange={vi.fn()}
				organizationId="org-1"
				editingPolicy={null}
				onSuccess={vi.fn()}
			/>,
		);

		rerender(
			<QueryClientProvider client={new QueryClient()}>
				<WorkPolicyDialog
					open={true}
					onOpenChange={vi.fn()}
					organizationId="org-1"
					editingPolicy={editablePolicy}
					onSuccess={vi.fn()}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Retail 38h")).toBeTruthy();
		});
		expect(screen.getByDisplayValue("Retail operations policy")).toBeTruthy();
		expect(screen.getAllByDisplayValue("38").length).toBeGreaterThan(0);
	});

	it("labels its fields and keeps a blank name from being saved", async () => {
		vi.mocked(updateWorkPolicy).mockClear();
		renderWithQueryClient(
			<WorkPolicyDialog
				open={true}
				onOpenChange={vi.fn()}
				organizationId="org-1"
				editingPolicy={editablePolicy}
				onSuccess={vi.fn()}
			/>,
		);

		const name = (await screen.findByLabelText("Name")) as HTMLInputElement;
		expect(name.value).toBe("Retail 38h");
		expect(screen.getByLabelText("Description")).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Work Schedule" })).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Time Regulation" })).toBeTruthy();
		expect(screen.getByLabelText("Hours per Cycle")).toBeTruthy();
		expect(screen.getByLabelText("Max Daily")).toBeTruthy();

		fireEvent.change(name, { target: { value: "   " } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(await screen.findByText("Enter a policy name")).toBeTruthy();
		expect(name.getAttribute("aria-invalid")).toBe("true");
		expect(updateWorkPolicy).not.toHaveBeenCalled();
	});

	it("tells admins on a simple schedule that a latest clock-in needs a detailed schedule", async () => {
		renderWithQueryClient(
			<WorkPolicyDialog
				open={true}
				onOpenChange={vi.fn()}
				organizationId="org-1"
				editingPolicy={editablePolicy}
				onSuccess={vi.fn()}
			/>,
		);
		expect(
			await screen.findByText(
				"A latest clock-in per day needs a detailed schedule. Switch to Detailed to set one.",
			),
		).toBeTruthy();
	});

	it("sets and clears the latest clock-in on work days of a detailed schedule", async () => {
		vi.mocked(updateWorkPolicy).mockResolvedValue({ success: true, data: undefined } as never);
		const workDay = (dayOfWeek: string, latestClockIn: string | null) => ({
			id: `day-${dayOfWeek}`,
			scheduleId: "schedule-1",
			dayOfWeek,
			hoursPerDay: "8",
			isWorkDay: true,
			cycleWeek: 1,
			latestClockIn,
		});
		const detailedPolicy = {
			...editablePolicy,
			schedule: {
				...editablePolicy.schedule,
				scheduleType: "detailed",
				workingDaysPreset: "custom",
				days: [
					workDay("monday", "09:00"),
					...["tuesday", "wednesday", "thursday", "friday"].map((day) => workDay(day, null)),
					{ ...workDay("saturday", null), hoursPerDay: "0", isWorkDay: false },
					{ ...workDay("sunday", null), hoursPerDay: "0", isWorkDay: false },
				],
			},
		} as unknown as WorkPolicyWithDetails;

		renderWithQueryClient(
			<WorkPolicyDialog
				open={true}
				onOpenChange={vi.fn()}
				organizationId="org-1"
				editingPolicy={detailedPolicy}
				onSuccess={vi.fn()}
			/>,
		);

		const monday = (await screen.findByLabelText("Latest clock-in on Monday")) as HTMLInputElement;
		expect(monday.value).toBe("09:00");
		// Non-work days have no latest clock-in.
		expect(screen.queryByLabelText("Latest clock-in on Saturday")).toBeNull();

		fireEvent.change(screen.getByLabelText("Latest clock-in on Tuesday"), {
			target: { value: "09:30" },
		});
		fireEvent.change(monday, { target: { value: "" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(updateWorkPolicy).toHaveBeenCalled());
		const [{ data: input }] = vi.mocked(updateWorkPolicy).mock.calls[0];
		const latest = Object.fromEntries(
			(input.schedule?.days ?? []).map((day) => [day.dayOfWeek, day.latestClockIn]),
		);
		expect(latest).toMatchObject({ monday: null, tuesday: "09:30", saturday: null });
	});

	it("loads all 7 ArbZG regulation fields and preserves them when saving an unrelated name change", async () => {
		vi.mocked(updateWorkPolicy).mockClear();
		vi.mocked(updateWorkPolicy).mockResolvedValue({ success: true, data: undefined } as never);
		const arbzgPolicy = {
			...editablePolicy,
			regulation: {
				...editablePolicy.regulation,
				minRestPeriodMinutes: 690,
				restPeriodEnforcement: "block",
				overtimeDailyThresholdMinutes: 510,
				overtimeWeeklyThresholdMinutes: 2310,
				overtimeMonthlyThresholdMinutes: 10200,
				alertBeforeLimitMinutes: 45,
				alertThresholdPercent: 90,
			},
		} as unknown as WorkPolicyWithDetails;

		renderWithQueryClient(
			<WorkPolicyDialog
				open={true}
				onOpenChange={vi.fn()}
				organizationId="org-1"
				editingPolicy={arbzgPolicy}
				onSuccess={vi.fn()}
			/>,
		);

		expect(((await screen.findByLabelText("Minimum Rest Period")) as HTMLInputElement).value).toBe(
			"11.5",
		);
		expect((screen.getByLabelText("Daily Overtime Threshold") as HTMLInputElement).value).toBe(
			"8.5",
		);
		expect((screen.getByLabelText("Weekly Overtime Threshold") as HTMLInputElement).value).toBe(
			"38.5",
		);
		expect((screen.getByLabelText("Monthly Overtime Threshold") as HTMLInputElement).value).toBe(
			"170",
		);
		expect((screen.getByLabelText("Alert Before Limit") as HTMLInputElement).value).toBe("45");
		expect((screen.getByLabelText("Alert Threshold") as HTMLInputElement).value).toBe("90");

		// Change only the policy name and save
		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Retail 38h Renamed" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(updateWorkPolicy).toHaveBeenCalled());
		const [{ data: submitted }] = vi.mocked(updateWorkPolicy).mock.calls[0];
		expect(submitted.name).toBe("Retail 38h Renamed");
		expect(submitted.regulation).toMatchObject({
			minRestPeriodMinutes: 690,
			restPeriodEnforcement: "block",
			overtimeDailyThresholdMinutes: 510,
			overtimeWeeklyThresholdMinutes: 2310,
			overtimeMonthlyThresholdMinutes: 10200,
			alertBeforeLimitMinutes: 45,
			alertThresholdPercent: 90,
		});
	});

	it("validates out-of-range ArbZG inputs and persists edited ArbZG values", async () => {
		vi.mocked(updateWorkPolicy).mockClear();
		vi.mocked(updateWorkPolicy).mockResolvedValue({ success: true, data: undefined } as never);
		const arbzgPolicy = {
			...editablePolicy,
			regulation: {
				...editablePolicy.regulation,
				minRestPeriodMinutes: 660,
				restPeriodEnforcement: "warn",
				overtimeDailyThresholdMinutes: 480,
				overtimeWeeklyThresholdMinutes: 2400,
				overtimeMonthlyThresholdMinutes: 10800,
				alertBeforeLimitMinutes: 30,
				alertThresholdPercent: 80,
			},
		} as unknown as WorkPolicyWithDetails;

		renderWithQueryClient(
			<WorkPolicyDialog
				open={true}
				onOpenChange={vi.fn()}
				organizationId="org-1"
				editingPolicy={arbzgPolicy}
				onSuccess={vi.fn()}
			/>,
		);

		const minRest = (await screen.findByLabelText("Minimum Rest Period")) as HTMLInputElement;
		const alertPercent = screen.getByLabelText("Alert Threshold") as HTMLInputElement;

		// Out-of-range values block submission via @tanstack/react-form
		fireEvent.change(minRest, { target: { value: "25" } });
		fireEvent.change(alertPercent, { target: { value: "150" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(await screen.findByText("Must be greater than 0 and at most 24 hours")).toBeTruthy();
		expect(await screen.findByText("Must be between 1 and 100%")).toBeTruthy();
		expect(minRest.getAttribute("aria-invalid")).toBe("true");
		expect(alertPercent.getAttribute("aria-invalid")).toBe("true");
		expect(updateWorkPolicy).not.toHaveBeenCalled();

		// Correct values and update all 7 fields
		fireEvent.change(minRest, { target: { value: "10" } });
		fireEvent.click(screen.getByRole("radio", { name: /Block/i }));
		fireEvent.change(screen.getByLabelText("Daily Overtime Threshold"), {
			target: { value: "9" },
		});
		fireEvent.change(screen.getByLabelText("Weekly Overtime Threshold"), {
			target: { value: "42" },
		});
		fireEvent.change(screen.getByLabelText("Monthly Overtime Threshold"), {
			target: { value: "185" },
		});
		fireEvent.change(screen.getByLabelText("Alert Before Limit"), { target: { value: "15" } });
		fireEvent.change(alertPercent, { target: { value: "75" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(updateWorkPolicy).toHaveBeenCalled());
		const [{ data: submitted }] = vi.mocked(updateWorkPolicy).mock.calls[0];
		expect(submitted.regulation).toMatchObject({
			minRestPeriodMinutes: 600,
			restPeriodEnforcement: "block",
			overtimeDailyThresholdMinutes: 540,
			overtimeWeeklyThresholdMinutes: 2520,
			overtimeMonthlyThresholdMinutes: 11100,
			alertBeforeLimitMinutes: 15,
			alertThresholdPercent: 75,
		});
	});

	it("checks actual versionEffectiveDates (not updatedAt) for same-day replacement warnings and sets min to org today", async () => {
		const todayUtc = new Date().toISOString().slice(0, 10);
		const futureScheduledDate = "2099-05-15";
		const otherFutureDate = "2099-06-20";
		const versionedPolicy = {
			...editablePolicy,
			// Deliberately set updatedAt to today even though today has NO version and 2099-05-15 DOES!
			updatedAt: new Date(`${todayUtc}T12:00:00.000Z`),
			versionEffectiveDates: ["1970-01-01", futureScheduledDate],
		} as unknown as WorkPolicyWithDetails;

		renderWithQueryClient(
			<WorkPolicyDialog
				open={true}
				onOpenChange={vi.fn()}
				organizationId="org-1"
				organizationTimezone="UTC"
				editingPolicy={versionedPolicy}
				workPolicyVersioningEnabled={true}
				onSuccess={vi.fn()}
			/>,
		);

		const dateInput = (await screen.findByLabelText(
			"New version effective from",
		)) as HTMLInputElement;
		expect(dateInput.min).toBe(todayUtc);
		expect(dateInput.value).toBe(todayUtc);

		// Make a rule edit so isRuleEdit is true
		fireEvent.change(screen.getByLabelText("Hours per Cycle"), { target: { value: "36" } });

		// Today is NOT in versionEffectiveDates (even though updatedAt is today) -> NO same-day warning!
		expect(screen.queryByText("Same-day revision replaces earlier version")).toBeNull();

		// Selecting futureScheduledDate (which IS in versionEffectiveDates) -> MUST show warning!
		fireEvent.change(dateInput, { target: { value: futureScheduledDate } });
		expect(await screen.findByText("Same-day revision replaces earlier version")).toBeTruthy();

		// Selecting another future date not in versionEffectiveDates -> warning clears!
		fireEvent.change(dateInput, { target: { value: otherFutureDate } });
		expect(screen.queryByText("Same-day revision replaces earlier version")).toBeNull();
	});
});
