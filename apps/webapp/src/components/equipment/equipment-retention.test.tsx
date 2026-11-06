// @vitest-environment jsdom
import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
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
async function openHoldPanel(
	user: ReturnType<typeof userEvent.setup>,
	name: string,
) {
	await user.click(screen.getByRole("button", { name }));
	return within(await screen.findByRole("dialog"));
}

it("exposes admin hold controls, focuses mandatory reason errors, submits a revisioned reason and closes once recorded", async () => {
	const user = userEvent.setup();
	const submit = vi.fn().mockResolvedValue(true);
	render(
		<EquipmentRetention
			assignment={assignment}
			timezone="Europe/Berlin"
			canAdminister
			pending={false}
			submit={submit}
		/>,
	);
	const card = within(screen.getByRole("region", { name: "Record retention" }));
	expect(card.getByText("Retained")).toBeTruthy();
	expect(card.getByText(/Mar 1, 2026/)).toBeTruthy();
	expect(card.getByText("None")).toBeTruthy();
	const panel = await openHoldPanel(user, "Place case hold");
	await user.click(panel.getByRole("button", { name: "Confirm hold" }));
	expect(submit).not.toHaveBeenCalled();
	expect(document.activeElement).toBe(
		panel.getByRole("textbox", { name: /Reason/ }),
	);
	await user.type(
		panel.getByRole("textbox", { name: /Reason/ }),
		"Case 47: preserve evidence",
	);
	await user.click(panel.getByRole("button", { name: "Confirm hold" }));
	await waitFor(() =>
		expect(submit).toHaveBeenCalledWith({
			kind: "place_case_hold",
			assignmentId: assignment.id,
			expectedRevision: 3,
			reason: "Case 47: preserve evidence",
			requestId: expect.any(String),
		}),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("shows protection and attributable hold history without controls for personal readers", async () => {
	const user = userEvent.setup();
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
	expect(screen.getByText("Active")).toBeTruthy();
	// The eligible-for-cleanup date is irrelevant while a hold protects the record.
	expect(screen.queryByText("Eligible for cleanup from")).toBeNull();
	await user.click(screen.getByText("Case hold history"));
	expect(screen.getByText(/Officer Ada/)).toBeTruthy();
	expect(screen.getByText("Case 47")).toBeTruthy();
	expect(screen.queryByRole("button")).toBeNull();
});

it("requires a release reason and preserves request identity across an uncertain unchanged retry", async () => {
	const user = userEvent.setup();
	const submit = vi.fn().mockResolvedValue(false);
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
	const panel = await openHoldPanel(user, "Release case hold");
	await user.click(panel.getByRole("button", { name: "Confirm release" }));
	expect(submit).not.toHaveBeenCalled();
	await user.type(
		panel.getByRole("textbox", { name: /Reason/ }),
		"The specific case has ended",
	);
	await user.click(panel.getByRole("button", { name: "Confirm release" }));
	await user.click(panel.getByRole("button", { name: "Confirm release" }));
	await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
	expect(submit.mock.calls[0][0]).toEqual(submit.mock.calls[1][0]);
	expect(submit.mock.calls[0][0]).toMatchObject({
		kind: "release_case_hold",
		expectedRevision: 3,
		reason: "The specific case has ended",
	});
	expect(screen.getByRole("dialog")).toBeTruthy();
});
