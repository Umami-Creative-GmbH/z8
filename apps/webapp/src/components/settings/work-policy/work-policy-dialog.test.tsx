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
		const [, input] = vi.mocked(updateWorkPolicy).mock.calls[0];
		const latest = Object.fromEntries(
			(input.schedule?.days ?? []).map((day) => [day.dayOfWeek, day.latestClockIn]),
		);
		expect(latest).toMatchObject({ monday: null, tuesday: "09:30", saturday: null });
	});
});
