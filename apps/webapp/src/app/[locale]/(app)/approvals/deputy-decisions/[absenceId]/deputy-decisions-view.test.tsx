/* @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createTolgee } from "@/tolgee/tolgee-core";
import { DeputyDecisionsView } from "./deputy-decisions-view";

vi.mock("@/navigation", () => ({
	Link: ({ href, ...props }: ComponentProps<"a">) => (
		<a href={`/de${href}`} {...props} />
	),
}));
afterEach(cleanup);

const props: ComponentProps<typeof DeputyDecisionsView> = {
	t: createTolgee().init({ language: "en", staticData: { en: {} } }).t,
	display: { locale: "en-GB", timezone: "Europe/Berlin", timeFormat: "24h" },
	result: {
		absence: {
			id: "absence-1",
			startDate: "2026-11-09",
			endDate: "2026-11-13",
		},
		decisions: [
			{
				id: "decision-1",
				entityType: "absence_entry",
				entityId: "request-1",
				requesterName: "Alex Requester",
				decision: "rejected",
				deputy: { employeeId: "deputy-1", name: "Sam Deputy" },
				decidedAt: new Date("2026-11-10T14:07:00Z"),
			},
		],
	},
};

it("leads with one task heading and dated scope, keeping return and every decision field", () => {
	render(<DeputyDecisionsView {...props} />);
	expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
	expect(
		screen.getByRole("heading", { level: 1, name: "Decided by your deputy" }),
	).toBeTruthy();
	expect(
		screen.getByRole("link", { name: "Back to inbox" }).getAttribute("href"),
	).toBe("/de/approvals/inbox");
	expect(screen.getByText(/9.*13 Nov 2026/)).toBeTruthy();
	const table = screen.getByRole("table", { name: "Decided by your deputy" });
	expect(
		within(table)
			.getAllByRole("columnheader")
			.map((e) => e.textContent),
	).toEqual([
		"Request",
		"Requested by",
		"Decision",
		"Decided by",
		"Decided at",
	]);
	const record = within(table).getAllByRole("row")[1];
	expect(
		within(record)
			.getAllByRole("cell")
			.map((e) => e.textContent),
	).toEqual([
		"Absence Requests",
		"Alex Requester",
		"Rejected",
		"Sam Deputy",
		"10 Nov 2026, 15:07",
	]);
});

it("keeps unknown requesters and request kinds honest, and respects 12-hour decision display", () => {
	const decision = props.result.decisions[0];
	render(
		<DeputyDecisionsView
			{...props}
			display={{ ...props.display, timeFormat: "12h" }}
			result={{
				...props.result,
				decisions: [
					{
						...decision,
						requesterName: null,
						entityType: "retained_unknown_kind",
						decision: "approved",
					},
				],
			}}
		/>,
	);
	expect(screen.getByRole("cell", { name: "Unknown" })).toBeTruthy();
	expect(
		screen.getByRole("cell", { name: "retained_unknown_kind" }),
	).toBeTruthy();
	expect(screen.getByRole("cell", { name: "Approved" })).toBeTruthy();
	expect(
		screen.getByRole("cell", { name: "10 Nov 2026, 3:07 pm" }),
	).toBeTruthy();
});

it("presents actual empty history with a return action and no fabricated record", () => {
	render(
		<DeputyDecisionsView
			{...props}
			result={{ ...props.result, decisions: [] }}
		/>,
	);
	expect(
		screen.getByText("Nobody decided approvals for you during this absence."),
	).toBeTruthy();
	expect(screen.queryByRole("table")).toBeNull();
	expect(screen.getByRole("link", { name: "Back to inbox" })).toBeTruthy();
});

it("retains every historical decision when the cancelled absence has no retained dates", () => {
	const decisions = Array.from({ length: 26 }, (_, index) => ({
		...props.result.decisions[0],
		id: `decision-${index}`,
		requesterName: `Requester ${index}`,
	}));
	render(
		<DeputyDecisionsView
			{...props}
			result={{
				absence: { id: "cancelled", startDate: null, endDate: null },
				decisions,
			}}
		/>,
	);
	expect(
		screen.getByText("Approvals decided for you while you were away."),
	).toBeTruthy();
	expect(screen.getAllByRole("row")).toHaveLength(27);
	expect(screen.getByRole("cell", { name: "Requester 25" })).toBeTruthy();
	expect(screen.queryByText(/2026.*2026/)).toBeNull();
});
