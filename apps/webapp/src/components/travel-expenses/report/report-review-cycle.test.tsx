/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => ({
	getTravelExpenseReportSubmission: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-review-actions", () => ({
	withdrawTravelExpenseReportAction: vi.fn(),
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

import { ReturnedNotice } from "./report-review-cycle";

afterEach(cleanup);

const returned = {
	note: "Please correct two things",
	returnedAt: "2026-09-20T10:00:00.000Z",
	reviewerName: "Riley Reviewer",
	itemComments: [
		{
			itemId: "taxi",
			type: "receipt" as const,
			number: 1,
			description: "Taxi",
			body: "Wrong date",
		},
		{
			itemId: "drive",
			type: "mileage" as const,
			number: 2,
			description: "Office – Airport",
			body: "Check the distance",
		},
		{
			itemId: "per-diem",
			type: "per_diem" as const,
			number: 3,
			description: "Per diem",
			body: "Breakfast was provided",
		},
	],
};

function comments() {
	return screen.getAllByRole("listitem").map((item) => item.textContent);
}

describe("ReturnedNotice", () => {
	it("numbers notes by the returned cycle for reviewers", () => {
		render(<ReturnedNotice returned={returned} />);
		expect(comments()).toEqual([
			"Receipt 1 (Taxi): Wrong date",
			"Mileage 2 (Office – Airport): Check the distance",
			"Per diem 3: Breakfast was provided",
		]);
	});

	it("names the owner's live items, and items removed since the return (#688)", () => {
		// The taxi was removed and a receipt added before the drive.
		render(
			<ReturnedNotice
				returned={returned}
				liveItems={[
					{ id: "hotel", type: "receipt" },
					{ id: "drive", type: "mileage" },
					{ id: "per-diem", type: "per_diem" },
				]}
			/>,
		);
		expect(comments()).toEqual([
			"Receipt (removed), Taxi: Wrong date",
			"Mileage 2 (Office – Airport): Check the distance",
			"Per diem 3: Breakfast was provided",
		]);
	});
});
