/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShiftTemplate } from "@/app/[locale]/(app)/scheduling/types";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { TemplateSidebar } from "./template-sidebar";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const template: ShiftTemplate = {
	id: "morning",
	organizationId: "org-a",
	name: "Morning reception",
	startTime: "09:00",
	endTime: "17:00",
	color: null,
	subareaId: null,
	isActive: true,
	createdAt: new Date("2026-11-01T00:00:00Z"),
	updatedAt: new Date("2026-11-01T00:00:00Z"),
	createdBy: "planner",
};

afterEach(cleanup);

describe("planner template access", () => {
	it("lets a planner choose a template without a drag gesture", () => {
		const choose = vi.fn();
		render(<TemplateSidebar templates={[template]} onSelectTemplate={choose} />);
		fireEvent.click(screen.getByRole("button", { name: /Morning reception/ }));
		expect(choose).toHaveBeenCalledWith(template);
	});
});

describe("template times (#2018)", () => {
	const late = { ...template, id: "late", name: "Late", startTime: "14:00", endTime: "22:00" };

	it("writes a template's times in the planner's 24-hour format, as the shift list does", () => {
		render(
			<UserPreferencesProvider timeFormat="24h">
				<TemplateSidebar templates={[late]} onSelectTemplate={vi.fn()} />
			</UserPreferencesProvider>,
		);
		expect(screen.getByText("14:00 – 22:00")).toBeTruthy();
		expect(screen.queryByText(/PM/)).toBeNull();
	});

	it("keeps 12-hour times for a planner who chose them", () => {
		render(
			<UserPreferencesProvider timeFormat="12h">
				<TemplateSidebar templates={[late]} onSelectTemplate={vi.fn()} />
			</UserPreferencesProvider>,
		);
		expect(screen.getByText("2:00 PM – 10:00 PM")).toBeTruthy();
	});
});
