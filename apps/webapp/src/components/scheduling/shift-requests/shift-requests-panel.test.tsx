/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShiftRequestWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import type { SkillValidationResult } from "@/lib/scheduling/skill-validation";

const {
	getPendingShiftRequestsMock,
	approveShiftRequestMock,
	rejectShiftRequestMock,
	useSkillValidationMock,
	toastSuccessMock,
	toastErrorMock,
} = vi.hoisted(() => ({
	getPendingShiftRequestsMock: vi.fn(),
	approveShiftRequestMock: vi.fn(),
	rejectShiftRequestMock: vi.fn(),
	useSkillValidationMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	getPendingShiftRequests: getPendingShiftRequestsMock,
	approveShiftRequest: approveShiftRequestMock,
	rejectShiftRequest: rejectShiftRequestMock,
}));

vi.mock("@/lib/query/use-skills", () => ({
	useSkillValidation: useSkillValidationMock,
}));

import { ShiftRequestsPanel } from "./shift-requests-panel";

const QUALIFIED: SkillValidationResult = {
	isQualified: true,
	missingSkills: [],
	expiredSkills: [],
};

const MISSING_FORKLIFT: SkillValidationResult = {
	isQualified: false,
	missingSkills: [
		{ id: "skill-forklift", name: "Forklift licence", category: "equipment", isRequired: true },
	],
	expiredSkills: [],
};

function buildRequest(
	overrides: Partial<ShiftRequestWithRelations> = {},
): ShiftRequestWithRelations {
	return {
		id: "request-1",
		shiftId: "shift-1",
		type: "pickup",
		requesterId: "employee-riley",
		targetEmployeeId: null,
		reason: null,
		reasonCategory: null,
		notes: null,
		status: "pending",
		createdAt: new Date("2026-10-15T08:00:00Z"),
		updatedAt: new Date("2026-10-15T08:00:00Z"),
		shift: {
			id: "shift-1",
			organizationId: "org-1",
			employeeId: null,
			subareaId: "subarea-dock",
			templateId: "template-early",
			// Berlin 2026-10-20 is stored as its local midnight.
			date: new Date("2026-10-19T22:00:00Z"),
			startTime: "06:00",
			endTime: "14:00",
			status: "published",
			subarea: { id: "subarea-dock", name: "Dock", location: { id: "loc-1", name: "Warehouse" } },
		},
		requester: {
			id: "employee-riley",
			firstName: null,
			lastName: null,
			user: { firstName: "Riley", lastName: "Requester" },
		},
		targetEmployee: null,
		...overrides,
	} as ShiftRequestWithRelations;
}

function renderPanel() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ShiftRequestsPanel
				open
				onOpenChange={vi.fn()}
				approverId="employee-manager"
				organizationTimezone="Europe/Berlin"
			/>
		</QueryClientProvider>,
	);
}

describe("ShiftRequestsPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getPendingShiftRequestsMock.mockResolvedValue({ success: true, data: [buildRequest()] });
		approveShiftRequestMock.mockResolvedValue({ success: true, data: { id: "request-1" } });
		rejectShiftRequestMock.mockResolvedValue({ success: true, data: { id: "request-1" } });
		useSkillValidationMock.mockReturnValue({ data: QUALIFIED, isLoading: false });
	});

	it("lists the organization's pending requests", async () => {
		renderPanel();

		expect(
			await screen.findByText("Riley Requester wants to pick up this open shift"),
		).toBeTruthy();
		expect(screen.getByText("Tue, Oct 20, 06:00–14:00")).toBeTruthy();
		expect(screen.getByText("Warehouse – Dock")).toBeTruthy();
	});

	it("shows the unmet required skills and approves with the planner's reason (#893)", async () => {
		useSkillValidationMock.mockReturnValue({ data: MISSING_FORKLIFT, isLoading: false });
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

		// Checked for the requester taking the shift, on its organization-local date.
		expect(useSkillValidationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-riley",
				subareaId: "subarea-dock",
				templateId: "template-early",
				date: "2026-10-20",
			}),
		);
		expect(screen.getByText("Skill Requirements Not Met")).toBeTruthy();
		expect(screen.getByText("Forklift licence")).toBeTruthy();

		fireEvent.change(screen.getByLabelText("Reason for the skill override"), {
			target: { value: "  Only trained driver on site  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

		await waitFor(() =>
			expect(approveShiftRequestMock).toHaveBeenCalledWith("request-1", {
				skillOverrideReason: "Only trained driver on site",
			}),
		);
		await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Request approved"));
	});

	it("asks for the reason inline when the server refuses the approval (#893)", async () => {
		approveShiftRequestMock.mockResolvedValueOnce({
			success: false,
			error: "Give a reason to assign an employee without every required skill",
			refusal: "skill_override_reason_required",
		});
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
		// Qualified as far as the client knows, so no reason is asked for yet.
		expect(screen.queryByLabelText("Reason for the skill override")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

		expect(
			await screen.findByText("Give a reason to assign an employee without every required skill."),
		).toBeTruthy();
		expect(toastErrorMock).not.toHaveBeenCalled();
		expect(approveShiftRequestMock).toHaveBeenCalledWith("request-1", {
			skillOverrideReason: undefined,
		});

		fireEvent.change(screen.getByLabelText("Reason for the skill override"), {
			target: { value: "Certificate renewal booked" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

		await waitFor(() =>
			expect(approveShiftRequestMock).toHaveBeenLastCalledWith("request-1", {
				skillOverrideReason: "Certificate renewal booked",
			}),
		);
		await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Request approved"));
	});

	it("shows other approval failures as a toast", async () => {
		approveShiftRequestMock.mockResolvedValueOnce({
			success: false,
			error: "This request was already decided",
		});
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
		fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith("Failed to approve the request", {
				description: "This request was already decided",
			}),
		);
		expect(screen.queryByLabelText("Reason for the skill override")).toBeNull();
	});

	it("checks a swap against the named colleague", async () => {
		getPendingShiftRequestsMock.mockResolvedValue({
			success: true,
			data: [
				buildRequest({
					type: "swap",
					targetEmployeeId: "employee-taylor",
					targetEmployee: {
						id: "employee-taylor",
						firstName: "Taylor",
						lastName: "Target",
					},
				}),
			],
		});
		renderPanel();

		expect(
			await screen.findByText("Riley Requester wants to hand this shift to Taylor Target"),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));

		expect(useSkillValidationMock).toHaveBeenCalledWith(
			expect.objectContaining({ employeeId: "employee-taylor" }),
		);
	});

	it("cannot approve a swap without a named colleague", async () => {
		getPendingShiftRequestsMock.mockResolvedValue({
			success: true,
			data: [buildRequest({ type: "swap", targetEmployeeId: null })],
		});
		renderPanel();

		const approve = (await screen.findByRole("button", { name: "Approve" })) as HTMLButtonElement;
		expect(approve.disabled).toBe(true);
	});

	it("rejects with the planner's optional reason", async () => {
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
		fireEvent.change(screen.getByLabelText("Reason for rejecting (optional)"), {
			target: { value: "Already fully staffed" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));

		await waitFor(() =>
			expect(rejectShiftRequestMock).toHaveBeenCalledWith("request-1", "Already fully staffed"),
		);
		await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Request rejected"));
	});

	it("says when nothing is pending", async () => {
		getPendingShiftRequestsMock.mockResolvedValue({ success: true, data: [] });
		renderPanel();

		expect(await screen.findByText("No pending requests")).toBeTruthy();
	});
});
