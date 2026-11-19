/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShiftTemplate } from "@/app/[locale]/(app)/scheduling/types";
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

describe("planner template access", () => {
	it("lets a planner choose a template without a drag gesture", () => {
		const choose = vi.fn();
		render(<TemplateSidebar templates={[template]} onSelectTemplate={choose} />);
		fireEvent.click(screen.getByRole("button", { name: /Morning reception/ }));
		expect(choose).toHaveBeenCalledWith(template);
	});
});
