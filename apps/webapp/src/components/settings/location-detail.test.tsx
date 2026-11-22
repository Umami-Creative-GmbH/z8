/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";
import { LocationDetail } from "./location-detail";

const mocks = vi.hoisted(() => ({
	getLocation: vi.fn(),
	removeLocationEmployee: vi.fn(),
	removeSubareaEmployee: vi.fn(),
	assignLocationEmployee: vi.fn(),
	assignSubareaEmployee: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/locations/actions", () => ({
	getLocation: mocks.getLocation,
	deleteLocation: vi.fn(),
	deleteSubarea: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/locations/assignment-actions", () => ({
	removeLocationEmployee: mocks.removeLocationEmployee,
	removeSubareaEmployee: mocks.removeSubareaEmployee,
	assignLocationEmployee: mocks.assignLocationEmployee,
	assignSubareaEmployee: mocks.assignSubareaEmployee,
}));

vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("./assigned-locations/location-assigned-employees-card", () => ({
	LocationAssignedEmployeesCard: () => null,
}));
vi.mock("./location-dialog", () => ({ LocationDialog: () => null }));
vi.mock("./location-employee-dialog", () => ({ LocationEmployeeDialog: () => null }));
vi.mock("./subarea-dialog", () => ({ SubareaDialog: () => null }));
vi.mock("./subarea-employee-dialog", () => ({ SubareaEmployeeDialog: () => null }));

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

function employeeRow(id: string, employeeId: string, firstName: string, isPrimary: boolean) {
	return {
		id,
		employeeId,
		isPrimary,
		employee: {
			id: employeeId,
			firstName,
			lastName: "Example",
			user: {
				id: `user-${employeeId}`,
				name: `${firstName} Example`,
				email: `${firstName}@example.com`,
			},
		},
	};
}

function locationFixture() {
	return {
		id: LOCATION_ID,
		organizationId: "org-1",
		name: "Head Office",
		street: null,
		city: "Berlin",
		postalCode: null,
		country: "DE",
		isActive: true,
		createdAt: new Date(),
		createdBy: "user-1",
		updatedAt: new Date(),
		updatedBy: null,
		subareaCount: 1,
		employeeCount: 1,
		employees: [employeeRow("assign-1", "emp-1", "Avery", true)],
		subareas: [
			{
				id: "sub-1",
				locationId: LOCATION_ID,
				name: "Warehouse",
				isActive: true,
				employees: [employeeRow("assign-2", "emp-2", "Blair", false)],
			},
		],
	};
}

function renderDetail() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<LocationDetail locationId={LOCATION_ID} organizationId="org-1" canManageLocations />,
		{
			wrapper: ({ children }) => (
				<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
			),
		},
	);
}

type UndoToastOptions = { action: { label: string; onClick: () => void } };

function lastUndoAction() {
	const options = mocks.toastSuccess.mock.calls.at(-1)?.[1] as UndoToastOptions | undefined;
	if (!options?.action) throw new Error("Expected an undo action on the removal toast");
	return options.action;
}

describe("LocationDetail assignment removal", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
		mocks.getLocation.mockResolvedValue({ success: true, data: locationFixture() });
		mocks.removeLocationEmployee.mockResolvedValue({ success: true, data: undefined });
		mocks.removeSubareaEmployee.mockResolvedValue({ success: true, data: undefined });
		mocks.assignLocationEmployee.mockResolvedValue({ success: true, data: { id: "new" } });
		mocks.assignSubareaEmployee.mockResolvedValue({ success: true, data: { id: "new" } });
	});

	it("names the removed supervisor and location, and undo re-adds the same primary assignment", async () => {
		const user = userEvent.setup();
		renderDetail();

		await user.click(await screen.findByRole("button", { name: "Remove: Avery Example" }));

		await waitFor(() => expect(mocks.removeLocationEmployee).toHaveBeenCalledWith("assign-1"));
		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith(
				"Removed Avery Example from Head Office",
				expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
			),
		);

		lastUndoAction().onClick();

		await waitFor(() =>
			expect(mocks.assignLocationEmployee).toHaveBeenCalledWith({
				locationId: LOCATION_ID,
				employeeId: "emp-1",
				isPrimary: true,
			}),
		);
		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Restored Avery Example"));
	});

	it("names the subarea, and undo re-adds the subarea assignment with its flags", async () => {
		const user = userEvent.setup();
		renderDetail();

		await user.click(await screen.findByRole("button", { name: "Remove: Blair Example" }));

		await waitFor(() => expect(mocks.removeSubareaEmployee).toHaveBeenCalledWith("assign-2"));
		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith(
				"Removed Blair Example from Warehouse",
				expect.anything(),
			),
		);

		lastUndoAction().onClick();

		await waitFor(() =>
			expect(mocks.assignSubareaEmployee).toHaveBeenCalledWith({
				subareaId: "sub-1",
				employeeId: "emp-2",
				isPrimary: false,
			}),
		);
	});

	it("reports a refused undo instead of claiming the assignment came back", async () => {
		mocks.assignLocationEmployee.mockResolvedValue({
			success: false,
			error: "Former employee",
			code: "ValidationError",
			refusal: "former_employee",
		});
		const user = userEvent.setup();
		renderDetail();

		await user.click(await screen.findByRole("button", { name: "Remove: Avery Example" }));
		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());

		lastUndoAction().onClick();

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith(
				"Former employees can't be chosen. Choose someone on the current roster.",
			),
		);
		expect(mocks.toastSuccess).toHaveBeenCalledOnce();
	});

	it("disables every removal while one is pending, so a removal cannot be sent twice", async () => {
		let finish!: (value: unknown) => void;
		mocks.removeLocationEmployee.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const user = userEvent.setup();
		renderDetail();

		const remove = await screen.findByRole("button", { name: "Remove: Avery Example" });
		await user.click(remove);

		expect((remove as HTMLButtonElement).disabled).toBe(true);
		expect(
			(screen.getByRole("button", { name: "Remove: Blair Example" }) as HTMLButtonElement).disabled,
		).toBe(true);
		await user.click(remove);
		expect(mocks.removeLocationEmployee).toHaveBeenCalledOnce();

		finish({ success: true, data: undefined });
		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
	});

	it("omits the header refresh button while keeping Retry on load error", async () => {
		renderDetail();
		await screen.findByRole("heading", { level: 1, name: "Head Office" });
		expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
	});

	it("renders an explicit Retry control when loading a location fails", async () => {
		const user = userEvent.setup();
		mocks.getLocation
			.mockResolvedValueOnce({ success: false, error: "Network error" })
			.mockResolvedValueOnce({ success: true, data: locationFixture() });
		renderDetail();

		expect(await screen.findByText("This location could not be loaded")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Retry" }));

		expect(await screen.findByRole("heading", { level: 1, name: "Head Office" })).toBeTruthy();
	});
});
