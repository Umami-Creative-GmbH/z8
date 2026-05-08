/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	AbsenceCategoryForm,
	type AbsenceCategoryForSettings,
	buildAbsenceCategoryPayload,
	defaultAbsenceCategoryFormValues,
	getAbsenceCategoryFormValues,
} from "./absence-category-form";

type ComponentWithChildren = { children?: React.ReactNode };

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ children, open }: ComponentWithChildren & { open: boolean }) =>
		open ? <div>{children}</div> : null,
	ActionPanelBody: ({ children }: ComponentWithChildren) => <div>{children}</div>,
	ActionPanelContent: ({ children }: ComponentWithChildren) => <div>{children}</div>,
	ActionPanelDescription: ({ children }: ComponentWithChildren) => <p>{children}</p>,
	ActionPanelFooter: ({ children }: ComponentWithChildren) => <div>{children}</div>,
	ActionPanelHeader: ({ children }: ComponentWithChildren) => <div>{children}</div>,
	ActionPanelTitle: ({ children }: ComponentWithChildren) => <h2>{children}</h2>,
}));

vi.mock("@/app/[locale]/(app)/settings/vacation/actions", () => ({
	createAbsenceCategory: vi.fn(),
	updateAbsenceCategory: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

beforeAll(() => {
	class ResizeObserverMock implements ResizeObserver {
		disconnect() {}
		observe() {}
		unobserve() {}
	}

	globalThis.ResizeObserver = ResizeObserverMock;
});

afterEach(() => {
	cleanup();
});

describe("absence category form helpers", () => {
	it("provides operational defaults for new categories", () => {
		expect(defaultAbsenceCategoryFormValues).toEqual({
			name: "",
			type: "custom",
			description: "",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: false,
			color: "#3b82f6",
			isActive: true,
		});
	});

	it("initializes edit values from an existing category", () => {
		const category: AbsenceCategoryForSettings = {
			id: "category_1",
			type: "sick",
			name: "Sick leave",
			description: null,
			requiresWorkTime: false,
			requiresApproval: false,
			countsAgainstVacation: false,
			color: null,
			isActive: false,
		};

		expect(getAbsenceCategoryFormValues(category)).toEqual({
			name: "Sick leave",
			type: "sick",
			description: "",
			requiresWorkTime: false,
			requiresApproval: false,
			countsAgainstVacation: false,
			color: "#3b82f6",
			isActive: false,
		});
	});

	it("builds a normalized payload for server actions", () => {
		expect(
			buildAbsenceCategoryPayload({
				...defaultAbsenceCategoryFormValues,
				name: "  Training  ",
				description: "  Planned training time  ",
				isActive: false,
			}),
		).toEqual({
			name: "Training",
			type: "custom",
			description: "Planned training time",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: false,
			color: "#3b82f6",
			isActive: false,
		});
	});

	it("resets form values when the edited absence category changes while mounted", () => {
		const firstCategory: AbsenceCategoryForSettings = {
			id: "category_1",
			type: "sick",
			name: "Sick leave",
			description: "Medical absence",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: false,
			color: "#ef4444",
			isActive: true,
		};
		const secondCategory: AbsenceCategoryForSettings = {
			id: "category_2",
			type: "parental",
			name: "Parental leave",
			description: "Family leave",
			requiresWorkTime: false,
			requiresApproval: false,
			countsAgainstVacation: false,
			color: "#8b5cf6",
			isActive: false,
		};

		const { rerender } = render(
			<AbsenceCategoryForm
				open={true}
				onOpenChange={vi.fn()}
				organizationId="org_1"
				existingCategory={firstCategory}
			/>,
		);
		const nameInput = screen.getByLabelText("Name") as HTMLInputElement;

		expect(nameInput.value).toBe("Sick leave");
		fireEvent.change(nameInput, { target: { value: "Stale manual edit" } });
		expect(nameInput.value).toBe("Stale manual edit");

		rerender(
			<AbsenceCategoryForm
				open={true}
				onOpenChange={vi.fn()}
				organizationId="org_1"
				existingCategory={secondCategory}
			/>,
		);

		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Parental leave");
	});
});
