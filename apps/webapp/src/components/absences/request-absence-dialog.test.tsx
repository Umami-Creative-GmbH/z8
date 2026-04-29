/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequestAbsenceDialog } from "./request-absence-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/[locale]/(app)/absences/actions", () => ({
	requestAbsence: vi.fn(),
}));

describe("RequestAbsenceDialog", () => {
	it("renders the open request form without missing form item context", () => {
		render(
			<RequestAbsenceDialog
				open
				onOpenChange={vi.fn()}
				remainingDays={10}
				categories={[
					{
						id: "vacation",
						name: "Vacation",
						type: "vacation",
						color: null,
						requiresApproval: true,
						countsAgainstVacation: true,
					},
				]}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Request Absence" })).toBeTruthy();
	});
});
