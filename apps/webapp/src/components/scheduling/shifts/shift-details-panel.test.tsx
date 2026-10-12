/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/components/ui/action-panel", () => {
	const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
	return {
		ActionPanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
			open ? <div role="dialog">{children}</div> : null,
		ActionPanelBody: Part,
		ActionPanelContent: Part,
		ActionPanelDescription: Part,
		ActionPanelFooter: Part,
		ActionPanelHeader: Part,
		ActionPanelTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	};
});

import { ShiftDetailsPanel } from "./shift-details-panel";

const nightShift = {
	id: "shift-1",
	organizationId: "org-1",
	employeeId: "employee-1",
	templateId: "template-1",
	subareaId: "subarea-1",
	recurrenceId: null,
	// Berlin midnight of 2026-10-09.
	date: new Date("2026-10-08T22:00:00Z"),
	startTime: "22:00",
	endTime: "06:00",
	status: "published",
	publishedAt: null,
	publishedBy: null,
	notes: "Bring the delivery keys",
	color: null,
	createdAt: new Date("2026-10-01T00:00:00Z"),
	createdBy: "user-1",
	updatedAt: new Date("2026-10-01T00:00:00Z"),
	template: { name: "Night" },
	subarea: { id: "subarea-1", name: "Floor", location: { id: "location-1", name: "Store" } },
} as ShiftWithRelations;

describe("ShiftDetailsPanel", () => {
	afterEach(cleanup);

	it("shows read-only details on the organization's date, not an edit form", () => {
		render(
			<ShiftDetailsPanel
				open
				onOpenChange={vi.fn()}
				shift={nightShift}
				organizationTimezone="Europe/Berlin"
			/>,
		);

		expect(screen.getByRole("heading", { name: "Shift details" })).toBeTruthy();
		expect(screen.queryByText("Edit Shift")).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.getByText("Night")).toBeTruthy();
		expect(screen.getByText("Friday, October 9, 2026")).toBeTruthy();
		expect(screen.getByText(/22:00 – 06:00/).closest("dd")?.textContent).toContain(
			"(ends next day)",
		);
		expect(screen.getByText("Store · Floor")).toBeTruthy();
		expect(screen.getByText("Bring the delivery keys")).toBeTruthy();
	});

	it("leaves out notes and place when the shift has none", () => {
		render(
			<ShiftDetailsPanel
				open
				onOpenChange={vi.fn()}
				shift={{ ...nightShift, notes: null, subarea: null, template: null }}
				organizationTimezone="Europe/Berlin"
			/>,
		);

		expect(screen.queryByText("Notes")).toBeNull();
		expect(screen.queryByText("Location")).toBeNull();
	});
});
