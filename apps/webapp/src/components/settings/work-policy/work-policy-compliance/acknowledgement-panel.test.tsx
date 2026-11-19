/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkPolicyViolationWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { AcknowledgementPanel } from "./acknowledgement-panel";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const violation = {
	id: "violation-1",
	violationDate: new Date("2026-07-01T09:00:00.000Z"),
	violationType: "max_daily",
	employee: {
		user: { firstName: "Avery", lastName: "Stone", name: null, email: "avery@example.com" },
	},
} as WorkPolicyViolationWithDetails;

describe("AcknowledgementPanel", () => {
	it("requests an acknowledgement reset when cancelled", async () => {
		const onCancel = vi.fn();

		render(
			<AcknowledgementPanel
				display={{ locale: "en-US", timezone: "Europe/Berlin" }}
				open
				violation={violation}
				note="Already addressed"
				onOpenChange={vi.fn()}
				onNoteChange={vi.fn()}
				onCancel={onCancel}
				onConfirm={vi.fn()}
				isPending={false}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("shows the violation day in the organization's timezone with the zone named", () => {
		render(
			<AcknowledgementPanel
				display={{ locale: "en-US", timezone: "Pacific/Auckland" }}
				open
				violation={{ ...violation, violationDate: new Date("2026-07-01T13:00:00.000Z") }}
				note=""
				onOpenChange={vi.fn()}
				onNoteChange={vi.fn()}
				onCancel={vi.fn()}
				onConfirm={vi.fn()}
				isPending={false}
			/>,
		);

		// 13:00 UTC is already 01:00 the next day in Auckland.
		expect(screen.getByText("Jul 2, 2026")).toBeTruthy();
		expect(screen.getByText("(Pacific/Auckland)")).toBeTruthy();
	});
});
