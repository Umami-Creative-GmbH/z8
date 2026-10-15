/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn(), refresh: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
	Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/app/[locale]/(app)/settings/employees/employment-date-actions", () => ({
	previewEmploymentDateCorrectionAction: mocks.preview,
	commitEmploymentDateCorrectionAction: mocks.commit,
}));

import { EmploymentDateCorrectionCard } from "./employment-date-correction-card";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
describe("actual joining date review", () => {
	it("reviews vacation and work then clears a stale correction without saving", async () => {
		mocks.preview.mockResolvedValue({
			success: true,
			data: {
				employeeId: "employee",
				employmentStartDate: "2024-01-01",
				previousEmploymentStartDate: "2026-05-21",
				employmentPeriodId: null,
				employmentBlockers: [],
				vacation: [
					{
						year: 2026,
						before: { allowanceDays: 20, remainingDays: 20, totalDays: 20 },
						after: { allowanceDays: 30, remainingDays: 30, totalDays: 30 },
					},
				],
				kind: "date_change",
				currentDate: "2026-05-21",
				proposedDate: "2026-05-21",
				employees: [],
				blockers: [],
				fingerprint: "reviewed",
			},
		});
		mocks.commit.mockResolvedValue({
			success: false,
			code: "stale_preview",
			error: "The reviewed employment or configuration changed. Generate a new preview.",
		});
		render(
			<EmploymentDateCorrectionCard
				employeeId="employee"
				employmentStartDate="2026-05-21"
				onSaved={mocks.refresh}
			/>,
		);
		expect(screen.queryByRole("button", { name: "Save reviewed employment date" })).toBeNull();
		fireEvent.change(screen.getByLabelText("Actual employment start"), {
			target: { value: "2024-01-01" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Review employment correction" }));
		expect(await screen.findAllByText("20 → 30")).toHaveLength(3);
		fireEvent.change(screen.getByLabelText("Reason for correction"), {
			target: { value: "Signed contract" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save reviewed employment date" }));
		await waitFor(() =>
			expect(mocks.commit).toHaveBeenCalledWith({
				employeeId: "employee",
				employmentStartDate: "2024-01-01",
				reason: "Signed contract",
				fingerprint: "reviewed",
			}),
		);
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"The reviewed employment or configuration changed. Generate a new preview.",
		);
		expect(screen.queryByRole("button", { name: "Save reviewed employment date" })).toBeNull();
	});
});
