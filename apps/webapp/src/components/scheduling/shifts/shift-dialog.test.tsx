/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const { deleteShiftMock, upsertShiftMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
	deleteShiftMock: vi.fn(),
	upsertShiftMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: {
		success: toastSuccessMock,
		error: toastErrorMock,
		warning: vi.fn(),
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	deleteShift: deleteShiftMock,
	upsertShift: upsertShiftMock,
}));

vi.mock("./use-shift-dialog-data", () => ({
	useShiftDialogData: () => ({
		employees: [],
		locations: [],
		skillValidation: null,
		isValidatingSkills: false,
	}),
}));

vi.mock("./use-shift-dialog-form", () => ({
	useShiftDialogForm: () => ({
		form: {
			handleSubmit: vi.fn(),
		},
		formValues: {
			employeeId: "",
			templateId: "",
			subareaId: "",
		},
	}),
}));

vi.mock("./shift-dialog-sections", async () => {
	const actual =
		await vi.importActual<typeof import("./shift-dialog-sections")>("./shift-dialog-sections");

	return {
		...actual,
		ShiftDialogSections: () => <div>sections</div>,
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
import { ShiftDialogFooterActions, type ShiftDialogFooterProps } from "./shift-dialog-sections";

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
					organizationTimezone="Europe/Berlin"
				/>
			</QueryClientProvider>
		);
	}

	return render(<Wrapper shift={props?.shift} initiallyOpen={props?.initiallyOpen} />);
}

describe("ShiftDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
					organizationTimezone="Europe/Berlin"
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
					organizationTimezone="Europe/Berlin"
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
});

describe("ShiftDialogFooterActions", () => {
	it("only represents valid mode, status, and permission combinations", () => {
		type CreateDeleting = Extract<ShiftDialogFooterProps, { mode: "create"; status: "deleting" }>;
		type ReadOnlySaving = Extract<ShiftDialogFooterProps, { canManage: false; status: "saving" }>;

		expectTypeOf<CreateDeleting>().toEqualTypeOf<never>();
		expectTypeOf<ReadOnlySaving>().toEqualTypeOf<never>();
	});

	it("shows create actions for a manager in idle state", () => {
		render(<ShiftDialogFooterActions mode="create" status="idle" canManage onCancel={vi.fn()} />);

		expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Create Shift" })).toBeTruthy();
	});

	it("shows edit actions and confirms before deleting", () => {
		const onDelete = vi.fn();
		render(<ShiftDialogFooterActions mode="edit" status="idle" canManage onDelete={onDelete} onCancel={vi.fn()} />);

		expect(screen.getByRole("button", { name: "Update Shift" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(onDelete).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Confirm Delete" }));
		expect(onDelete).toHaveBeenCalledTimes(1);
	});

	it.each(["create", "edit"] as const)("shows only cancel in read-only %s mode", (mode) => {
		render(<ShiftDialogFooterActions mode={mode} status="idle" canManage={false} onCancel={vi.fn()} />);

		expect(screen.getAllByRole("button")).toHaveLength(1);
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
	});

	it.each(["create", "edit"] as const)("shows saving state in %s mode", (mode) => {
		render(
			mode === "create" ? (
				<ShiftDialogFooterActions mode="create" status="saving" canManage onCancel={vi.fn()} />
			) : (
				<ShiftDialogFooterActions mode="edit" status="saving" canManage onDelete={vi.fn()} onCancel={vi.fn()} />
			),
		);

		expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled).toBe(true);
	});

	it("shows deleting state while preserving the edit submit label", () => {
		const { container } = render(
			<ShiftDialogFooterActions mode="edit" status="deleting" canManage onDelete={vi.fn()} onCancel={vi.fn()} />,
		);
		const buttons = screen.getAllByRole("button") as HTMLButtonElement[];

		expect(buttons).toHaveLength(3);
		expect(buttons.every((button) => button.disabled)).toBe(true);
		expect(container.querySelector(".animate-spin")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Update Shift" })).toBeTruthy();
	});

	it("invokes cancel and clears delete confirmation", () => {
		const onCancel = vi.fn();
		render(<ShiftDialogFooterActions mode="edit" status="idle" canManage onDelete={vi.fn()} onCancel={onCancel} />);

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
	});
});
