/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createWorkCategorySet,
	getOrganizationCategories,
	getWorkCategorySetDetail,
	updateSetCategories,
	updateWorkCategorySet,
} from "@/app/[locale]/(app)/settings/work-categories/actions";
import { WorkCategorySetDialog } from "./work-category-set-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match),
	}),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/[locale]/(app)/settings/work-categories/actions", () => ({
	createWorkCategorySet: vi.fn(),
	getOrganizationCategories: vi.fn(),
	getWorkCategorySetDetail: vi.fn(),
	updateSetCategories: vi.fn(),
	updateWorkCategorySet: vi.fn(),
}));

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
		Element.prototype.getAnimations = () => [];
	}
});

function category(id: string, name: string) {
	return {
		id,
		organizationId: "org-1",
		name,
		description: null,
		factor: "1.00",
		color: null,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		usedInSetsCount: 1,
	};
}

function renderDialog(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("WorkCategorySetDialog ordering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getOrganizationCategories).mockResolvedValue({
			success: true,
			data: [category("cat-a", "Travel"), category("cat-b", "Standby")],
		} as never);
		vi.mocked(getWorkCategorySetDetail).mockResolvedValue({
			success: true,
			data: {
				set: { id: "set-1", name: "Field", description: null },
				categories: [
					{ ...category("cat-a", "Travel"), sortOrder: 0 },
					{ ...category("cat-b", "Standby"), sortOrder: 1 },
				],
			},
		} as never);
		vi.mocked(updateWorkCategorySet).mockResolvedValue({ success: true, data: undefined } as never);
		vi.mocked(updateSetCategories).mockResolvedValue({ success: true, data: undefined } as never);
	});

	afterEach(cleanup);

	it("names the category and direction on 32px move buttons and saves the new order", async () => {
		renderDialog(
			<WorkCategorySetDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-1"
				categorySet={{ id: "set-1", name: "Field", description: null }}
				onSuccess={vi.fn()}
			/>,
		);

		const moveTravelUp = await screen.findByRole("button", { name: "Move Travel up" });
		const moveTravelDown = screen.getByRole("button", { name: "Move Travel down" });
		const moveStandbyDown = screen.getByRole("button", { name: "Move Standby down" });

		expect(moveTravelUp).toHaveProperty("disabled", true);
		expect(moveStandbyDown).toHaveProperty("disabled", true);
		expect(moveTravelDown.className).toContain("size-8");
		expect(screen.getByRole("button", { name: "Remove Travel from set" })).toBeTruthy();

		fireEvent.click(moveTravelDown);

		const list = screen.getByRole("list");
		const items = within(list).getAllByRole("listitem");
		expect(items[0]?.textContent).toContain("Standby");
		expect(items[1]?.textContent).toContain("Travel");

		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(updateSetCategories).toHaveBeenCalledWith({
				setId: "set-1",
				categoryIds: ["cat-b", "cat-a"],
			}),
		);
	});

	it("validates required set name inline, preserves values on failure, and prevents duplicate submission", async () => {
		const user = userEvent.setup();
		let finish!: (value: { success: false; error: string }) => void;
		vi.mocked(createWorkCategorySet).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}) as never,
		);

		renderDialog(
			<WorkCategorySetDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-1"
				categorySet={null}
				onSuccess={vi.fn()}
			/>,
		);

		expect(screen.getByRole("dialog").getAttribute("data-slot")).toBe("action-panel-content");

		await user.click(screen.getByRole("button", { name: "Create" }));
		expect(await screen.findByText("Category set name is required")).toBeTruthy();
		expect(createWorkCategorySet).not.toHaveBeenCalled();

		const nameInput = screen.getByLabelText(/Name/);
		const descriptionInput = screen.getByLabelText("Description");
		await user.type(nameInput, "Shift Set");
		await user.type(descriptionInput, "Night shift categories");

		const createButton = screen.getByRole("button", { name: "Create" });
		await user.click(createButton);
		await waitFor(() => expect(createWorkCategorySet).toHaveBeenCalledTimes(1));
		expect(createButton).toHaveProperty("disabled", true);
		fireEvent.submit(nameInput.closest("form") as HTMLFormElement);
		expect(createWorkCategorySet).toHaveBeenCalledTimes(1);

		finish({ success: false, error: "Set already exists" });
		await waitFor(() => expect(createButton).toHaveProperty("disabled", false));
		expect((nameInput as HTMLInputElement).value).toBe("Shift Set");
		expect((descriptionInput as HTMLTextAreaElement).value).toBe("Night shift categories");
	});
});
