/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act as actPreact } from "preact/test-utils";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";

const { getShiftsMock, upsertShiftMock } = vi.hoisted(() => ({
	upsertShiftMock: vi.fn(),
	getShiftsMock: vi.fn(
		async (): Promise<{ success: true; data: ShiftWithRelations[] }> => ({
			success: true,
			data: [],
		}),
	),
}));

import { ShiftDialog } from "../shifts/shift-dialog";
import { ShiftScheduler } from "./shift-scheduler";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	getShifts: getShiftsMock,
	getShiftTemplates: async () => ({ success: true, data: [] }),
	getScheduleComplianceSummary: async () => ({
		success: true,
		data: { summary: { totalFindings: 0 } },
	}),
	getPendingShiftRequests: async () => ({ success: true, data: [] }),
	upsertShift: upsertShiftMock,
	deleteShift: vi.fn(),
	publishShifts: vi.fn(),
	suggestStaffingForShift: async () => ({ success: true, data: [] }),
	getLocationsWithSubareas: async () => ({ success: true, data: [] }),
}));
vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	listEmployeesForSelect: async () => ({ success: true, data: { employees: [] } }),
}));
vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	validateEmployeeForShift: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/coverage-rules/actions", () => ({
	getTargetHeatmapData: async () => ({ success: true, data: [] }),
}));
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});
afterEach(async () => {
	actPreact(() => cleanup());
	await new Promise((r) => setTimeout(r, 50));
});
it("offers a visible Create Shift action without needing a template or gesture", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ShiftScheduler
				organizationId="org-a"
				organizationTimezone="Europe/Berlin"
				employeeId="planner-a"
				isManager
				focusEmployeeId={null}
				focusDate="2026-11-16"
			/>
		</QueryClientProvider>,
	);
	expect(await screen.findByRole("button", { name: "Create Shift" })).toBeTruthy();
});

it("offers a non-gesture way to open a shift with its date, time, place and status", async () => {
	getShiftsMock.mockResolvedValueOnce({
		success: true,
		data: [
			{
				id: "shift-a",
				organizationId: "org-a",
				employeeId: null,
				status: "draft",
				date: new Date("2026-11-15T23:00:00Z"),
				startTime: "09:00",
				endTime: "17:00",
				templateId: null,
				subareaId: "reception",
				recurrenceId: null,
				publishedAt: null,
				publishedBy: null,
				notes: null,
				color: null,
				createdAt: new Date("2026-11-01T00:00:00Z"),
				updatedAt: new Date("2026-11-01T00:00:00Z"),
				createdBy: "planner",
				subarea: { id: "reception", name: "Reception", location: { id: "office", name: "Office" } },
			},
		],
	});
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ShiftScheduler
				organizationId="org-a"
				organizationTimezone="Europe/Berlin"
				employeeId="planner-a"
				isManager
				focusEmployeeId={null}
				focusDate="2026-11-16"
			/>
		</QueryClientProvider>,
	);
	const record = await screen.findByRole("button", { name: /Reception/ });
	fireEvent.click(record);
	expect(await screen.findByRole("dialog", { name: "Edit Shift" })).toBeTruthy();
	expect(screen.getAllByDisplayValue("09:00").length).toBeGreaterThan(0);
	expect(screen.getAllByDisplayValue("17:00").length).toBeGreaterThan(0);
});

it("retains a pending edit when Escape is pressed and submits only once", async () => {
	let finish: (value: unknown) => void = () => {};
	upsertShiftMock.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const close = vi.fn();
	render(
		<QueryClientProvider client={client}>
			<ShiftDialog
				open
				onOpenChange={close}
				shift={null}
				defaultDate="2026-11-16"
				organizationId="org-a"
				organizationTimezone="Europe/Berlin"
				templates={[]}
				isManager
			/>
		</QueryClientProvider>,
	);
	const form = screen.getByRole("button", { name: "Create Shift" }).closest("form");
	if (!form) throw Error("No shift form");
	act(() => {
		fireEvent.submit(form);
		fireEvent.submit(form);
	});
	await waitFor(() => expect(upsertShiftMock).toHaveBeenCalled());
	fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
	expect(close).not.toHaveBeenCalled();
	expect(upsertShiftMock).toHaveBeenCalledTimes(1);
	await act(async () => finish({ success: false, error: "Save refused" }));
	expect(await screen.findByRole("button", { name: "Create Shift" })).toBeTruthy();
});

it.each(["success", "refusal", "rejection"] as const)(
	"keeps the pending edit session across Activity hiding and late %s",
	async (outcome) => {
		let finish: (value: unknown) => void = () => {};
		let reject: (error: Error) => void = () => {};
		upsertShiftMock.mockImplementation(
			() =>
				new Promise((resolve, refuse) => {
					finish = resolve;
					reject = refuse;
				}),
		);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const close = vi.fn();
		const draw = (mode: "visible" | "hidden") => (
			<QueryClientProvider client={client}>
				<Activity mode={mode}>
					<ShiftDialog
						open
						onOpenChange={close}
						shift={null}
						defaultDate="2026-11-16"
						organizationId="org-a"
						organizationTimezone="Europe/Berlin"
						templates={[]}
						isManager
					/>
				</Activity>
			</QueryClientProvider>
		);
		const view = render(draw("visible"));
		fireEvent.change(screen.getByLabelText(/Notes/), {
			target: { value: "Keep this assignment note" },
		});
		const form = screen.getByRole("button", { name: "Create Shift" }).closest("form");
		if (!form) throw Error("No shift form");
		fireEvent.submit(form);
		await waitFor(() => expect(upsertShiftMock).toHaveBeenCalledTimes(1));
		view.rerender(draw("hidden"));
		await act(async () => {
			if (outcome === "rejection") reject(new Error("Transport rejected"));
			else if (outcome === "refusal") finish({ success: false, error: "Save refused" });
			else
				finish({ success: true, data: { metadata: { hasOverlap: false, overlappingShifts: [] } } });
		});
		view.rerender(draw("visible"));
		if (outcome === "success") await waitFor(() => expect(close).toHaveBeenCalledWith(false));
		else {
			expect(await screen.findByRole("button", { name: "Create Shift" })).toBeTruthy();
			expect(screen.getByDisplayValue("Keep this assignment note")).toBeTruthy();
			expect(close).not.toHaveBeenCalled();
		}
	},
);

it("names the planner fields and autofills the chosen template", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ShiftDialog
				open
				onOpenChange={vi.fn()}
				shift={null}
				defaultDate="2026-11-16"
				defaultTemplateId="morning"
				organizationId="org-a"
				organizationTimezone="Europe/Berlin"
				isManager
				templates={[
					{
						id: "morning",
						organizationId: "org-a",
						name: "Morning reception",
						startTime: "07:30",
						endTime: "15:45",
						color: null,
						subareaId: null,
						isActive: true,
						createdBy: "planner",
						createdAt: new Date("2026-11-01T00:00:00Z"),
						updatedAt: new Date("2026-11-01T00:00:00Z"),
					},
				]}
			/>
		</QueryClientProvider>,
	);
	expect(screen.getByLabelText(/Template/)).toBeTruthy();
	expect(screen.getByLabelText(/Subarea/)).toBeTruthy();
	expect(screen.getByLabelText("Assign To")).toBeTruthy();
	await waitFor(() => expect(screen.getByLabelText("Start Time")).toHaveProperty("value", "07:30"));
	expect(screen.getByLabelText("End Time")).toHaveProperty("value", "15:45");
});
