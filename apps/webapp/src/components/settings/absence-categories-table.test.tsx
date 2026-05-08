/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AbsenceCategoriesTable } from "./absence-categories-table";

type ComponentWithChildren = { children?: React.ReactNode };

const mocks = vi.hoisted(() => ({
	getAbsenceCategoriesForSettings: vi.fn(),
	updateAbsenceCategory: vi.fn(),
	setAbsenceCategoryActive: vi.fn(),
	deleteAbsenceCategory: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/vacation/actions", () => ({
	getAbsenceCategoriesForSettings: mocks.getAbsenceCategoriesForSettings,
	updateAbsenceCategory: mocks.updateAbsenceCategory,
	setAbsenceCategoryActive: mocks.setAbsenceCategoryActive,
	deleteAbsenceCategory: mocks.deleteAbsenceCategory,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: {
		success: mocks.toastSuccess,
		error: mocks.toastError,
	},
}));

vi.mock("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children, open }: ComponentWithChildren & { open: boolean }) =>
		open ? <div>{children}</div> : null,
	AlertDialogAction: ({
		children,
		onClick,
		disabled,
	}: ComponentWithChildren & { onClick?: () => void; disabled?: boolean }) => (
		<button type="button" onClick={onClick} disabled={disabled}>
			{children}
		</button>
	),
	AlertDialogCancel: ({ children }: ComponentWithChildren) => (
		<button type="button">{children}</button>
	),
	AlertDialogContent: ({ children }: ComponentWithChildren) => <div>{children}</div>,
	AlertDialogDescription: ({ children }: ComponentWithChildren) => <p>{children}</p>,
	AlertDialogFooter: ({ children }: ComponentWithChildren) => <div>{children}</div>,
	AlertDialogHeader: ({ children }: ComponentWithChildren) => <div>{children}</div>,
	AlertDialogTitle: ({ children }: ComponentWithChildren) => <h2>{children}</h2>,
}));

vi.mock("./absence-category-form", () => ({
	AbsenceCategoryForm: ({
		open,
		existingCategory,
	}: {
		open: boolean;
		existingCategory?: { name: string };
	}) =>
		open ? (
			<div>{existingCategory ? `Editing ${existingCategory.name}` : "Create category form"}</div>
		) : null,
}));

const categories = [
	{
		id: "cat_1",
		type: "sick",
		name: "Sick leave",
		description: "Medical absence",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#ef4444",
		isActive: true,
	},
	{
		id: "cat_2",
		type: "custom",
		name: "Training",
		description: null,
		requiresWorkTime: true,
		requiresApproval: false,
		countsAgainstVacation: true,
		color: null,
		isActive: false,
	},
];

function renderTable(canManageCategories: boolean) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<AbsenceCategoriesTable organizationId="org_1" canManageCategories={canManageCategories} />
		</QueryClientProvider>,
	);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("AbsenceCategoriesTable", () => {
	it("hides mutating controls when category management is not allowed", async () => {
		mocks.getAbsenceCategoriesForSettings.mockResolvedValue({ success: true, data: categories });

		renderTable(false);

		expect(await screen.findByText("Sick leave")).toBeTruthy();
		expect(screen.queryByText("Add category")).toBeNull();
		expect(screen.queryByText("Edit")).toBeNull();
		expect(screen.queryByText("Delete")).toBeNull();
	});

	it("toggles only active status without resubmitting cached row fields", async () => {
		mocks.getAbsenceCategoriesForSettings.mockResolvedValue({ success: true, data: categories });
		mocks.setAbsenceCategoryActive.mockResolvedValue({
			success: true,
			data: { ...categories[0], isActive: false },
		});

		renderTable(true);

		fireEvent.pointerDown(await screen.findByLabelText("Open menu Sick leave"));
		fireEvent.click(await screen.findByText("Deactivate"));

		await waitFor(() => expect(mocks.setAbsenceCategoryActive).toHaveBeenCalled());
		expect(mocks.setAbsenceCategoryActive).toHaveBeenCalledWith("cat_1", false);
		expect(mocks.updateAbsenceCategory).not.toHaveBeenCalled();
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Absence category deactivated");
	});

	it("uses typographic ellipsis in the search placeholder", async () => {
		mocks.getAbsenceCategoriesForSettings.mockResolvedValue({ success: true, data: categories });

		renderTable(true);

		expect(await screen.findByPlaceholderText("Search categories…")).toBeTruthy();
	});

	it("shows the server conflict message when delete is rejected", async () => {
		mocks.getAbsenceCategoriesForSettings.mockResolvedValue({ success: true, data: categories });
		mocks.deleteAbsenceCategory.mockResolvedValue({
			success: false,
			error: "Deactivate this category instead because it is used by existing absences.",
		});

		renderTable(true);

		fireEvent.pointerDown(await screen.findByLabelText("Open menu Sick leave"));
		fireEvent.click(await screen.findByText("Delete"));
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => expect(mocks.deleteAbsenceCategory).toHaveBeenCalledWith("cat_1"));
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Deactivate this category instead because it is used by existing absences.",
		);
	});
});
