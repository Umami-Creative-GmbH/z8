// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EquipmentRetention } from "./equipment-retention";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
afterEach(cleanup);
const assignment = {
	id: "15490000-0000-4000-8000-000000000001",
	revision: 3,
	retention: {
		lastActivityAt: "2026-01-31T22:30:00Z",
		expiresAt: "2026-02-28T23:00:00Z",
		caseHeld: false,
		status: "retained" as const,
	},
	caseHolds: [],
};
it("exposes admin hold controls, focuses mandatory reason errors, and submits a revisioned reason", async () => {
	const user = userEvent.setup();
	const submit = vi.fn();
	render(
		<EquipmentRetention
			assignment={assignment}
			timezone="Europe/Berlin"
			canAdminister
			pending={false}
			submit={submit}
		/>,
	);
	expect(screen.getByText(/Mar 1, 2026/)).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Place case hold" }));
	await user.click(screen.getByRole("button", { name: "Confirm hold" }));
	expect(submit).not.toHaveBeenCalled();
	expect(document.activeElement).toBe(
		screen.getByRole("textbox", { name: /Reason/ }),
	);
	await user.type(
		screen.getByRole("textbox", { name: /Reason/ }),
		"Case 47: preserve evidence",
	);
	await user.click(screen.getByRole("button", { name: "Confirm hold" }));
	await waitFor(() =>
		expect(submit).toHaveBeenCalledWith({
			kind: "place_case_hold",
			assignmentId: assignment.id,
			expectedRevision: 3,
			reason: "Case 47: preserve evidence",
			requestId: expect.any(String),
		}),
	);
});
it("shows protection and attributable hold history without controls for personal readers", () => {
	render(
		<EquipmentRetention
			assignment={{
				...assignment,
				retention: {
					...assignment.retention,
					status: "case_hold",
					caseHeld: true,
				},
				caseHolds: [
					{
						id: "event",
						kind: "place",
						reason: "Case 47",
						actorName: "Officer Ada",
						recordedAt: "2026-01-31T22:30:00Z",
					},
				],
			}}
			timezone="Europe/Berlin"
			canAdminister={false}
			pending={false}
			submit={vi.fn()}
		/>,
	);
	expect(screen.getByText("Protected by a documented case hold.")).toBeTruthy();
	expect(screen.getByText(/Officer Ada/)).toBeTruthy();
	expect(screen.getByText(/Case 47/)).toBeTruthy();
	expect(screen.queryByRole("button")).toBeNull();
});
it("requires a release reason and preserves request identity across an uncertain unchanged retry", async () => {
	const user = userEvent.setup();
	const submit = vi.fn();
	render(
		<EquipmentRetention
			assignment={{
				...assignment,
				retention: {
					...assignment.retention,
					caseHeld: true,
					status: "case_hold",
				},
			}}
			timezone="Europe/Berlin"
			canAdminister
			pending={false}
			submit={submit}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Release case hold" }));
	await user.click(screen.getByRole("button", { name: "Confirm release" }));
	expect(submit).not.toHaveBeenCalled();
	await user.type(
		screen.getByRole("textbox", { name: /Reason/ }),
		"The specific case has ended",
	);
	await user.click(screen.getByRole("button", { name: "Confirm release" }));
	await user.click(screen.getByRole("button", { name: "Confirm release" }));
	await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
	expect(submit.mock.calls[0][0]).toEqual(submit.mock.calls[1][0]);
	expect(submit.mock.calls[0][0]).toMatchObject({
		kind: "release_case_hold",
		expectedRevision: 3,
		reason: "The specific case has ended",
	});
});
