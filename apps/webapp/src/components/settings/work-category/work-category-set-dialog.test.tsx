/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
});
