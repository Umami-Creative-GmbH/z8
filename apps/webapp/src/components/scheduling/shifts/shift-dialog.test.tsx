/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	deleteShiftMock,
	upsertShiftMock,
	toastSuccessMock,
	toastErrorMock,
	skillValidationMock,
	formValuesMock,
	translateMock,
} = vi.hoisted(() => ({
	deleteShiftMock: vi.fn(),
	upsertShiftMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	toastErrorMock: vi.fn(),
	skillValidationMock: vi.fn(),
	formValuesMock: vi.fn(),
	translateMock: vi.fn((_key: string, fallback: string) => fallback),
}));

vi.mock("sonner", () => ({
	toast: {
		success: toastSuccessMock,
		error: toastErrorMock,
		warning: vi.fn(),
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: translateMock,
	}),
}));

vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	deleteShift: deleteShiftMock,
	upsertShift: upsertShiftMock,
}));

vi.mock("./use-shift-dialog-data", () => ({
	useShiftDialogData: () => ({
		employees: [],
		locations: [],
		skillValidation: skillValidationMock(),
		isValidatingSkills: false,
	}),
}));

vi.mock("./use-shift-dialog-form", () => ({
	useShiftDialogForm: ({ onSubmit }: { onSubmit: (values: unknown) => void }) => ({
		form: {
			handleSubmit: vi.fn(() => onSubmit(formValuesMock())),
		},
		formValues: formValuesMock(),
	}),
}));

vi.mock("./shift-dialog-sections", async () => {
	const actual =
		await vi.importActual<typeof import("./shift-dialog-sections")>("./shift-dialog-sections");

	return {
		...actual,
		ShiftDialogSections: ({
			skillValidation,
		}: {
			skillValidation: null | { issues?: Array<{ id: string; name: string }> };
		}) => (
			<div>
				sections
				{skillValidation?.issues?.map((issue) => (
					<div key={issue.id}>{issue.name}</div>
				))}
			</div>
		),
	};
});

vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
		open ? <div>{children}</div> : null,
	DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ShiftDialog } from "./shift-dialog";

function buildShift(id: string) {
	return {
		id,
		organizationId: "org-1",
	} as never;
}

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
}

function createShiftDialogSectionsForm() {
	const fields: Record<string, unknown> = {
		date: new Date("2026-04-29T00:00:00.000Z"),
		templateId: null,
		startTime: "09:00",
		endTime: "17:00",
		subareaId: "subarea-1",
		employeeId: "employee-1",
		notes: "",
	};
	const validators = new Map<string, unknown>();

	return {
		validators,
		form: {
			Field: ({
				name,
				validators: fieldValidators,
				children,
			}: {
				name: string;
				validators?: unknown;
				children: (field: {
					state: { value: unknown; meta: { errors: readonly unknown[] } };
					handleChange: (value: unknown) => void;
					handleBlur: () => void;
				}) => React.ReactNode;
			}) => {
				if (fieldValidators) {
					validators.set(name, fieldValidators);
				}

				return children({
					state: { value: fields[name], meta: { errors: [] } },
					handleChange: (value) => {
						fields[name] = value;
					},
					handleBlur: vi.fn(),
				});
			},
		},
	};
}

function renderShiftDialogWithLocalOpenState(props?: {
	shift?: ReturnType<typeof buildShift>;
	initiallyOpen?: boolean;
}) {
	const queryClient = createQueryClient();

	function Wrapper({
		shift = buildShift("shift-1"),
		initiallyOpen = true,
	}: {
		shift?: ReturnType<typeof buildShift>;
		initiallyOpen?: boolean;
	}) {
		const [open, setOpen] = useState(initiallyOpen);

		return (
			<QueryClientProvider client={queryClient}>
				<button type="button" onClick={() => setOpen(true)}>
					Open
				</button>
				<ShiftDialog
					open={open}
					onOpenChange={setOpen}
					shift={shift ?? null}
					templates={[]}
					isManager
					defaultDate={null}
					organizationId="org-1"
				/>
			</QueryClientProvider>
		);
	}

	return render(<Wrapper shift={props?.shift} initiallyOpen={props?.initiallyOpen} />);
}

describe("ShiftDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		translateMock.mockImplementation((_key: string, fallback: string) => fallback);
		skillValidationMock.mockReturnValue(null);
		formValuesMock.mockReturnValue({
			employeeId: "employee-1",
			templateId: null,
			subareaId: "subarea-1",
			date: new Date("2026-04-29T00:00:00.000Z"),
			startTime: "09:00",
			endTime: "17:00",
			notes: "",
			color: undefined,
		});
		deleteShiftMock.mockResolvedValue({ success: true, data: undefined });
		upsertShiftMock.mockResolvedValue({
			success: true,
			data: {
				metadata: {
					hasOverlap: false,
					overlappingShifts: [],
					skillWarning: null,
				},
			},
		});
	});

	it("adds form metadata to shift select controls", async () => {
		const actual =
			await vi.importActual<typeof import("./shift-dialog-sections")>("./shift-dialog-sections");
		const { form } = createShiftDialogSectionsForm();

		render(
			<form>
				<actual.ShiftDialogSections
					form={form as never}
					formValues={formValuesMock()}
					isManager
					templates={[
						{
							id: "template-1",
							name: "Day Shift",
							startTime: "09:00",
							endTime: "17:00",
							isActive: true,
						} as never,
					]}
					locations={[
						{
							name: "HQ",
							subareas: [{ id: "subarea-1", name: "Floor 1", isActive: true }],
						} as never,
					]}
					employees={[{ id: "employee-1", firstName: "Kai", lastName: "Avery" } as never]}
					skillValidation={null}
					isValidatingSkills={false}
					isEditing={false}
					shift={null}
				/>
			</form>,
		);

		expect(document.querySelector('[name="templateId"]')).toBeTruthy();
		expect(document.querySelector('[name="subareaId"]')).toBeTruthy();
		expect(document.querySelector('[name="employeeId"]')).toBeTruthy();
	});

	it("uses translated invalid time validation messages", async () => {
		translateMock.mockImplementation((key: string, fallback: string) =>
			key === "scheduling.shiftDialog.invalidTimeFormat" ? "Translated invalid time" : fallback,
		);
		const actual =
			await vi.importActual<typeof import("./shift-dialog-sections")>("./shift-dialog-sections");
		const { form, validators } = createShiftDialogSectionsForm();

		render(
			<actual.ShiftDialogSections
				form={form as never}
				formValues={formValuesMock()}
				isManager
				templates={[]}
				locations={[]}
				employees={[]}
				skillValidation={null}
				isValidatingSkills={false}
				isEditing={false}
				shift={null}
			/>,
		);

		for (const fieldName of ["startTime", "endTime"]) {
			const fieldValidators = validators.get(fieldName) as {
				onChange: {
					safeParse: (value: string) => { error?: { issues: Array<{ message: string }> } };
				};
			};
			expect(fieldValidators.onChange.safeParse("bad").error?.issues[0]?.message).toBe(
				"Translated invalid time",
			);
		}
	});

	it("submits override reasons only while the current validation requires an override", async () => {
		skillValidationMock.mockReturnValue({
			isQualified: false,
			hasBlockingIssues: false,
			requiresOverride: true,
			missingSkills: [],
			expiredSkills: [],
			issues: [],
		});

		const queryClient = createQueryClient();
		const { rerender } = render(
			<QueryClientProvider client={queryClient}>
				<ShiftDialog
					open
					onOpenChange={vi.fn()}
					shift={buildShift("shift-1")}
					templates={[]}
					isManager
					defaultDate={null}
					organizationId="org-1"
				/>
			</QueryClientProvider>,
		);

		fireEvent.change(screen.getByLabelText("Qualification override reason"), {
			target: { value: "Supervisor approved" },
		});

		skillValidationMock.mockReturnValue({
			isQualified: true,
			hasBlockingIssues: false,
			requiresOverride: false,
			missingSkills: [],
			expiredSkills: [],
			issues: [],
		});
		formValuesMock.mockReturnValue({
			employeeId: "employee-2",
			templateId: null,
			subareaId: "subarea-1",
			date: new Date("2026-04-29T00:00:00.000Z"),
			startTime: "09:00",
			endTime: "17:00",
			notes: "",
			color: undefined,
		});

		rerender(
			<QueryClientProvider client={queryClient}>
				<ShiftDialog
					open
					onOpenChange={vi.fn()}
					shift={buildShift("shift-1")}
					templates={[]}
					isManager
					defaultDate={null}
					organizationId="org-1"
				/>
			</QueryClientProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Update Shift" }));

		await waitFor(() => {
			expect(upsertShiftMock).toHaveBeenCalledWith(
				expect.not.objectContaining({ qualificationOverrideReason: "Supervisor approved" }),
			);
		});
	});

	it("resets the override reason when assignment inputs change", async () => {
		skillValidationMock.mockReturnValue({
			isQualified: false,
			hasBlockingIssues: false,
			requiresOverride: true,
			missingSkills: [],
			expiredSkills: [],
			issues: [],
		});

		const queryClient = createQueryClient();
		const { rerender } = render(
			<QueryClientProvider client={queryClient}>
				<ShiftDialog
					open
					onOpenChange={vi.fn()}
					shift={buildShift("shift-1")}
					templates={[]}
					isManager
					defaultDate={null}
					organizationId="org-1"
				/>
			</QueryClientProvider>,
		);

		fireEvent.change(screen.getByLabelText("Qualification override reason"), {
			target: { value: "Supervisor approved" },
		});
		expect(screen.getByLabelText("Qualification override reason")).toHaveProperty(
			"value",
			"Supervisor approved",
		);

		formValuesMock.mockReturnValue({
			employeeId: "employee-1",
			templateId: "template-2",
			subareaId: "subarea-1",
			date: new Date("2026-04-29T00:00:00.000Z"),
			startTime: "09:00",
			endTime: "17:00",
			notes: "",
			color: undefined,
		});

		rerender(
			<QueryClientProvider client={queryClient}>
				<ShiftDialog
					open
					onOpenChange={vi.fn()}
					shift={buildShift("shift-1")}
					templates={[]}
					isManager
					defaultDate={null}
					organizationId="org-1"
				/>
			</QueryClientProvider>,
		);

		await waitFor(() => {
			expect(screen.getByLabelText("Qualification override reason")).toHaveProperty("value", "");
		});
	});

	it("requires and focuses an override reason before submitting an override assignment", async () => {
		skillValidationMock.mockReturnValue({
			isQualified: false,
			hasBlockingIssues: false,
			requiresOverride: true,
			missingSkills: [],
			expiredSkills: [],
			issues: [],
		});

		renderShiftDialogWithLocalOpenState();

		fireEvent.click(screen.getByRole("button", { name: "Update Shift" }));

		const overrideReason = screen.getByLabelText("Qualification override reason");
		expect(await screen.findByText("Explain why this override is needed before saving."));
		expect(upsertShiftMock).not.toHaveBeenCalled();
		expect(overrideReason.getAttribute("aria-invalid")).toBe("true");
		expect(document.activeElement).toBe(overrideReason);
	});

	it("resets delete confirmation after cancel closes the dialog", async () => {
		renderShiftDialogWithLocalOpenState();

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(screen.getByRole("button", { name: "Confirm Delete" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
		});

		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(deleteShiftMock).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Confirm Delete" })).toBeTruthy();
	});

	it("resets delete confirmation when a different shift is opened", () => {
		const queryClient = createQueryClient();
		const { rerender } = render(
			<QueryClientProvider client={queryClient}>
				<ShiftDialog
					open
					onOpenChange={vi.fn()}
					shift={buildShift("shift-1")}
					templates={[]}
					isManager
					defaultDate={null}
					organizationId="org-1"
				/>
			</QueryClientProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(screen.getByRole("button", { name: "Confirm Delete" })).toBeTruthy();

		rerender(
			<QueryClientProvider client={queryClient}>
				<ShiftDialog
					open
					onOpenChange={vi.fn()}
					shift={buildShift("shift-2")}
					templates={[]}
					isManager
					defaultDate={null}
					organizationId="org-1"
				/>
			</QueryClientProvider>,
		);

		expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(deleteShiftMock).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Confirm Delete" })).toBeTruthy();
	});

	it("resets delete confirmation after a successful delete closes the dialog", async () => {
		renderShiftDialogWithLocalOpenState();

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		fireEvent.click(screen.getByRole("button", { name: "Confirm Delete" }));

		await waitFor(() => {
			expect(deleteShiftMock).toHaveBeenCalledTimes(1);
		});

		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
		});

		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(deleteShiftMock).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Confirm Delete" })).toBeTruthy();
	});

	it("disables save for blocking qualification issues", async () => {
		skillValidationMock.mockReturnValue({
			isQualified: false,
			hasBlockingIssues: true,
			requiresOverride: false,
			missingSkills: [],
			expiredSkills: [],
			issues: [
				{
					id: "skill-1",
					name: "Forklift License",
					category: "certification",
					isRequired: true,
					enforcementMode: "blocking",
					issueType: "missing",
				},
			],
		});
		upsertShiftMock.mockResolvedValue({
			success: true,
			data: {
				metadata: {
					hasOverlap: false,
					overlappingShifts: [],
					skillWarning: {
						isQualified: false,
						hasBlockingIssues: true,
						requiresOverride: false,
						missingSkills: [],
						expiredSkills: [],
						issues: [
							{
								id: "skill-1",
								name: "Forklift License",
								category: "certification",
								isRequired: true,
								enforcementMode: "blocking",
								issueType: "missing",
							},
						],
					},
				},
			},
		});

		renderShiftDialogWithLocalOpenState();

		expect(await screen.findByText("Forklift License")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Update Shift" })).toHaveProperty("disabled", true);
	});

	it("keeps save enabled and override hidden for preferred-only qualification issues", async () => {
		skillValidationMock.mockReturnValue({
			isQualified: true,
			hasBlockingIssues: false,
			requiresOverride: false,
			missingSkills: [
				{
					id: "skill-preferred",
					name: "Forklift Familiarity",
					category: "certification",
					isRequired: false,
				},
			],
			expiredSkills: [],
			issues: [
				{
					id: "skill-preferred",
					name: "Forklift Familiarity",
					category: "certification",
					isRequired: false,
					enforcementMode: "warning",
					issueType: "preferred",
				},
			],
		});

		renderShiftDialogWithLocalOpenState();

		expect(await screen.findByText("Forklift Familiarity")).toBeTruthy();
		expect(screen.queryByLabelText("Qualification override reason")).toBeNull();
		expect(screen.getByRole("button", { name: "Update Shift" })).toHaveProperty("disabled", false);

		fireEvent.click(screen.getByRole("button", { name: "Update Shift" }));

		await waitFor(() => {
			expect(upsertShiftMock).toHaveBeenCalledWith(
				expect.not.objectContaining({ qualificationOverrideReason: expect.any(String) }),
			);
		});
	});
});
