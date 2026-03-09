/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
