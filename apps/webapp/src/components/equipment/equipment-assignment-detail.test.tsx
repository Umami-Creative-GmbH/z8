// @vitest-environment jsdom
import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
	EquipmentAssignmentView,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";
import { historyEntries } from "./equipment-history";
import { EquipmentAssignmentDetail } from "./equipment-workspace";
import {
	heldAssignment,
	ids,
	issue,
	partialAssignment,
	stubLayoutApis,
	view,
} from "./testing/equipment-view.test-fixture";

const api = vi.hoisted(() => ({
	change: vi.fn(),
	refresh: vi.fn(),
	replace: vi.fn(),
	push: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/organization/equipment/actions", () => ({
	changeEquipment: api.change,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({
		refresh: api.refresh,
		replace: api.replace,
		push: api.push,
	}),
	Link: ({ children, ...props }: React.ComponentProps<"a">) => (
		<a {...props}>{children}</a>
	),
}));
vi.mock("@tolgee/react", async () => {
	const { translate } = await import("./testing/equipment-view.test-fixture");
	return {
		useTranslate: () => ({ t: translate }),
		useTolgee: () => ({ getLanguage: () => "en" }),
	};
});
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: api.toast }));
vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <span aria-hidden="true" />,
}));
beforeAll(stubLayoutApis);
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function detail(
	assignment: EquipmentAssignmentView,
	data: Partial<EquipmentView> = {},
	back = "/equipment",
) {
	return render(
		<EquipmentAssignmentDetail
			data={{ ...view, ...data, assignments: [assignment] }}
			back={back}
		/>,
	);
}
async function correct(
	user: ReturnType<typeof userEvent.setup>,
	target: string,
) {
	await user.click(screen.getByRole("button", { name: "Correct a record" }));
	await user.click(await screen.findByRole("menuitem", { name: target }));
	return within(await screen.findByRole("dialog"));
}

describe("Assignment page", () => {
	it("heads the page with the item and its status, and leads back to the list it came from", () => {
		detail(
			{ ...heldAssignment, serialNumber: "C02XK1" },
			{},
			"/equipment?overdue=true",
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "L-02" }),
		).toBeTruthy();
		expect(screen.getByText("Laptop · Serial C02XK1")).toBeTruthy();
		expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
		expect(
			screen
				.getByRole("link", { name: "Back to equipment" })
				.getAttribute("href"),
		).toBe("/equipment?overdue=true");
		expect(
			screen.getByRole("link", { name: "Alex Current" }).getAttribute("href"),
		).toBe(`/equipment/employees/${ids.alex}`);
	});

	it("shows the effective and independent explicit/departure dates on former-employee follow-up", () => {
		detail({
			...heldAssignment,
			former: true,
			effectiveDeadline: "2026-11-03",
			departureDeadline: "2026-11-03",
		});
		const facts = screen.getByText("Effective return deadline").closest("dl");
		if (!facts) throw new Error("Expected the facts list");
		expect(within(facts).getByText("Departure return deadline")).toBeTruthy();
		expect(within(facts).getByText("Explicit return deadline")).toBeTruthy();
		expect(within(facts).getAllByText("Nov 3, 2026")).toHaveLength(2);
		expect(within(facts).getByText("Nov 4, 2026")).toBeTruthy();
		expect(within(facts).getByText("2 days overdue")).toBeTruthy();
		expect(screen.getByText("Former")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Record receipt" })).toBeTruthy();
	});

	it("shows issued, received and outstanding quantities separately", () => {
		detail(partialAssignment);
		const value = (label: string) =>
			screen.getByText(label).nextElementSibling?.textContent;
		expect(value("Issued quantity")).toBe("3");
		expect(value("Physically received quantity")).toBe("2");
		expect(value("Outstanding quantity")).toBe("1");
		expect(screen.getByText("Two shirts back")).toBeTruthy();
	});

	it("offers only permitted header commands", () => {
		const { rerender } = detail({ ...heldAssignment, canReceive: false });
		for (const name of ["Record receipt", "Transfer", "Close return"])
			expect(screen.queryByRole("button", { name })).toBeNull();
		rerender(
			<EquipmentAssignmentDetail
				data={{
					...view,
					employees: [
						...view.employees,
						{ id: ids.jamie, name: "Jamie New", image: null, former: false },
					],
					assignments: [
						{
							...heldAssignment,
							canCloseException: true,
							transfer: {
								expectedIssuanceRevision: 4,
								defaultReturnRequired: false,
							},
						},
					],
				}}
				back="/equipment"
			/>,
		);
		for (const name of ["Record receipt", "Transfer", "Close return"])
			expect(screen.getByRole("button", { name })).toBeTruthy();
	});

	it("requires a dated physical receipt when the original historical issue date is unknown", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({ success: true, data: { ok: true } });
		detail({
			...heldAssignment,
			issue: { ...issue, actualDate: null, historical: true },
		});
		await user.click(screen.getByRole("button", { name: "Record receipt" }));
		const panel = within(await screen.findByRole("dialog"));
		await user.click(panel.getByRole("button", { name: "Record receipt" }));
		expect(
			await panel.findByText("Enter the actual handover date."),
		).toBeTruthy();
		expect(panel.queryByLabelText("Actual issue date is unknown")).toBeNull();
		await user.type(panel.getByLabelText(/Actual handover date/), "2026-11-04");
		await user.click(panel.getByRole("button", { name: "Record receipt" }));
		await waitFor(() =>
			expect(api.change).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "receive_individual",
					actualDate: "2026-11-04",
					assignmentId: heldAssignment.id,
				}),
			),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
});

describe("Handover history", () => {
	it("merges handovers, decisions and calendar milestones newest first without inventing times", () => {
		const assignment: EquipmentAssignmentView = {
			...partialAssignment,
			departureDeadline: "2026-11-04",
			exceptions: [
				{
					id: "loss",
					kind: "lost",
					quantity: 1,
					receivedQuantity: 0,
					reason: "Missing",
					actorId: "admin",
					actorName: "Sam Admin",
					// November 4 in Berlin, though still November 3 in UTC.
					recordedAt: "2026-11-03T23:30:00Z",
					canReceive: true,
				},
			],
			corrections: [
				{
					id: "c",
					handoverId: "partial",
					exceptionId: null,
					expectedRevision: 3,
					reason: "Count",
					before: { quantity: 3 },
					after: { quantity: 2 },
					actorId: "admin",
					actorName: "Sam Admin",
					recordedAt: "2026-11-04T12:00:00Z",
				},
			],
			transfers: [
				{
					direction: "out",
					handoverId: "partial",
					counterpartName: "Jamie New",
				},
			],
		};
		const entries = historyEntries(assignment, "Europe/Berlin");
		expect(entries.map((entry) => [entry.kind, entry.date])).toEqual([
			["deadline_passed", "2026-11-04"],
			["departure_deadline", "2026-11-04"],
			["exception", "2026-11-04"],
			["receipt", "2026-11-03"],
			["issue", "2026-11-01"],
		]);
		expect(entries[3]).toMatchObject({
			amended: true,
			transfer: { counterpartName: "Jamie New" },
		});
		const unknown = historyEntries(
			{
				...heldAssignment,
				issue: { ...issue, actualDate: null },
				overdue: false,
			},
			"Europe/Berlin",
		);
		expect(unknown).toEqual([
			expect.objectContaining({ kind: "issue", date: null }),
		]);
	});

	it("renders amendments, transfers and the overdue milestone, and records a recovery from its decision", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({
			success: true,
			data: { ok: true, id: heldAssignment.id, revision: 8 },
		});
		const loss = {
			id: "15400000-0000-4000-8000-000000000099",
			kind: "lost" as const,
			quantity: 2,
			receivedQuantity: 0,
			reason: "Missing after move",
			actorId: "owner",
			actorName: "Pat Owner",
			recordedAt: "2026-11-04T23:30:00Z",
			canReceive: true,
		};
		detail({
			...heldAssignment,
			trackingMode: "quantity",
			quantity: 3,
			outstandingQuantity: 1,
			lostQuantity: 2,
			exceptions: [loss],
			transfers: [
				{ direction: "in", handoverId: "issue", counterpartName: null },
			],
			corrections: [
				{
					id: "c",
					handoverId: "issue",
					exceptionId: null,
					expectedRevision: 3,
					reason: "Signed agreement",
					before: { condition: "worn" },
					after: { condition: "good" },
					actorId: "admin",
					actorName: "Sam Admin",
					recordedAt: "2026-11-04T12:00:00Z",
				},
			],
		});
		expect(screen.getByText("Return deadline passed")).toBeTruthy();
		expect(screen.getByText("Transferred from another holder")).toBeTruthy();
		expect(screen.getByText("Amended")).toBeTruthy();
		expect(
			screen.getByText("Lost quantity").nextElementSibling?.textContent,
		).toBe("2");
		await user.click(screen.getByRole("button", { name: "Record recovery" }));
		const panel = within(await screen.findByRole("dialog"));
		await user.click(panel.getByRole("button", { name: "Confirm recovery" }));
		expect(
			await panel.findByText("Enter the actual handover date."),
		).toBeTruthy();
		await user.type(
			panel.getByLabelText(/^Actual handover date/),
			"2026-11-05",
		);
		await user.selectOptions(panel.getByLabelText("Condition"), "damaged");
		await user.type(panel.getByLabelText("Notes (optional)"), "Found at site");
		const quantity = panel.getByLabelText(/^Quantity/);
		await user.clear(quantity);
		await user.type(quantity, "3");
		await user.click(panel.getByRole("button", { name: "Confirm recovery" }));
		expect(api.change).not.toHaveBeenCalled();
		await user.clear(quantity);
		await user.type(quantity, "1");
		await user.click(panel.getByRole("button", { name: "Confirm recovery" }));
		await waitFor(() => expect(api.change).toHaveBeenCalledTimes(1));
		expect(api.change.mock.calls[0][0]).toMatchObject({
			kind: "receive_exception",
			assignmentId: heldAssignment.id,
			exceptionId: loss.id,
			expectedRevision: 7,
			quantity: 1,
			actualDate: "2026-11-05",
			condition: "damaged",
			notes: "Found at site",
		});
		expect(api.toast.success).toHaveBeenCalledWith(
			"Equipment action recorded.",
		);
		expect(api.refresh).toHaveBeenCalled();
	});

	it("receives waived equipment through its linked decision without relabeling it as a loss recovery", async () => {
		api.change.mockResolvedValue({ success: false });
		const user = userEvent.setup();
		const waiver = {
			id: "15400000-0000-4000-8000-000000000098",
			kind: "waived" as const,
			quantity: 1,
			receivedQuantity: 0,
			reason: "Permission to keep",
			actorId: "owner",
			actorName: "Pat Owner",
			recordedAt: "2026-11-04T23:30:00Z",
			canReceive: true,
		};
		detail({
			...heldAssignment,
			canReceive: false,
			outstanding: false,
			overdue: false,
			outstandingQuantity: 0,
			waivedQuantity: 1,
			exceptions: [waiver],
		});
		expect(
			screen.queryByRole("button", { name: "Record recovery" }),
		).toBeNull();
		await user.click(
			screen.getByRole("button", { name: "Record waived receipt" }),
		);
		const panel = within(await screen.findByRole("dialog"));
		expect(
			panel.getByRole("heading", { name: "Receive waived equipment" }),
		).toBeTruthy();
		await user.type(
			panel.getByLabelText(/^Actual handover date/),
			"2026-11-05",
		);
		await user.click(
			panel.getByRole("button", { name: "Confirm waived receipt" }),
		);
		await waitFor(() => expect(api.change).toHaveBeenCalledTimes(1));
		expect(api.change.mock.calls[0][0]).toMatchObject({
			kind: "receive_exception",
			assignmentId: heldAssignment.id,
			exceptionId: waiver.id,
			quantity: 1,
		});
		expect(api.toast.error).toHaveBeenCalled();
	});
});

describe("Corrections", () => {
	it("requires a correction reason and keeps a rejected amendment open with actionable errors", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({
			success: true,
			data: { ok: false, reason: "stale_revision" },
		});
		detail({
			...heldAssignment,
			canCorrect: true,
			canCorrectReceipt: false,
			canCorrectException: false,
			corrections: [],
		});
		const panel = await correct(user, "Correct issuance");
		expect(panel.getByLabelText("Return required")).toHaveProperty(
			"disabled",
			true,
		);
		expect(
			panel.getByText(
				"Permission to keep required equipment uses the owner/admin waiver action. This amendment keeps the return requirement.",
			),
		).toBeTruthy();
		await user.click(panel.getByRole("button", { name: "Save amendment" }));
		expect(
			await panel.findByText("Enter a reason for this amendment."),
		).toBeTruthy();
		expect(api.change).not.toHaveBeenCalled();
		await user.type(
			panel.getByLabelText(/^Amendment reason/),
			"Signed agreement lists worn condition",
		);
		await user.selectOptions(panel.getByLabelText("Condition"), "worn");
		await user.click(panel.getByRole("button", { name: "Save amendment" }));
		await waitFor(() => expect(api.change).toHaveBeenCalledTimes(1));
		expect(api.change.mock.calls[0][0]).toMatchObject({
			kind: "correct_issue",
			assignmentId: heldAssignment.id,
			expectedRevision: heldAssignment.revision,
			condition: "worn",
			reason: "Signed agreement lists worn condition",
		});
		expect(api.toast.error).toHaveBeenCalledWith(
			expect.stringContaining("Reload equipment"),
		);
		expect(panel.getByLabelText(/^Amendment reason/)).toHaveProperty(
			"value",
			"Signed agreement lists worn condition",
		);
	});

	it("amends explicitly unknown historical dates without inventing a date or changing employment context", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({ success: true, data: { ok: true } });
		detail({
			...heldAssignment,
			canCorrect: true,
			issue: { ...issue, historical: true, actualDate: null },
		});
		const panel = await correct(user, "Correct issuance");
		expect(panel.getByLabelText("Actual issue date unknown")).toHaveProperty(
			"checked",
			true,
		);
		expect(panel.queryByLabelText(/^Actual handover date/)).toBeNull();
		await user.type(
			panel.getByLabelText(/^Amendment reason/),
			"Original issue date remains unknown",
		);
		await user.click(panel.getByRole("button", { name: "Save amendment" }));
		await waitFor(() => expect(api.change).toHaveBeenCalled());
		expect(api.change.mock.calls[0][0]).toMatchObject({
			kind: "correct_issue",
			actualDate: null,
			employmentPeriodId: null,
			quantity: 1,
		});
		expect(api.toast.success).toHaveBeenCalledWith("Amendment recorded.");
	});

	it("offers an admin an effective exception quantity including a complete reversal", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({ success: true, data: { ok: true } });
		detail({
			...heldAssignment,
			canCorrect: true,
			canCorrectException: true,
			exceptions: [
				{
					id: "exception",
					kind: "lost",
					quantity: 1,
					receivedQuantity: 0,
					reason: "Missing",
					actorId: "admin",
					actorName: "Sam Admin",
					recordedAt: "2026-11-03T10:00:00Z",
					canReceive: false,
				},
			],
		});
		const panel = await correct(user, "Correct exception 1");
		await user.clear(panel.getByLabelText(/^Quantity/));
		await user.type(panel.getByLabelText(/^Quantity/), "0");
		await user.type(
			panel.getByLabelText(/^Amendment reason/),
			"Loss was recorded against the wrong count",
		);
		await user.click(panel.getByRole("button", { name: "Save amendment" }));
		await waitFor(() => expect(api.change).toHaveBeenCalled());
		expect(api.change.mock.calls[0][0]).toMatchObject({
			kind: "correct_exception",
			quantity: 0,
			exceptionId: "exception",
			outcome: "lost",
			decisionReason: "Missing",
		});
	});

	it("submits both transfer handovers together and offers receipt correction without exception authority", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({ success: true, data: { ok: true } });
		detail(
			{
				...partialAssignment,
				canCorrect: true,
				canCorrectReceipt: true,
				canCorrectException: false,
				exceptions: [
					{
						id: "exception",
						kind: "lost",
						quantity: 1,
						receivedQuantity: 0,
						reason: "Missing",
						actorId: "admin",
						actorName: "Sam Admin",
						recordedAt: "2026-11-03T10:00:00Z",
						canReceive: false,
					},
				],
				correctionTransfers: [
					{
						destinationAssignmentId: "destination",
						expectedDestinationRevision: 4,
						receiptId: partialAssignment.receipts[0].id,
						issue: {
							...partialAssignment.issue,
							id: "destination-issue",
							quantity: 2,
							actualDate: "2026-11-04",
						},
					},
				],
			},
			{ canAdminister: false },
		);
		await user.click(screen.getByRole("button", { name: "Correct a record" }));
		const menu = within(await screen.findByRole("menu"));
		expect(
			menu.getAllByRole("menuitem").map((item) => item.textContent),
		).toEqual(["Correct issuance", "Correct receipt 1", "Correct transfer 1"]);
		await user.click(
			menu.getByRole("menuitem", { name: "Correct transfer 1" }),
		);
		const panel = within(await screen.findByRole("dialog"));
		await user.clear(panel.getByLabelText(/^Quantity/));
		await user.type(panel.getByLabelText(/^Quantity/), "1");
		await user.type(
			panel.getByLabelText(/^Amendment reason/),
			"One shirt moved in this transfer",
		);
		await user.click(panel.getByRole("button", { name: "Save amendment" }));
		await waitFor(() => expect(api.change).toHaveBeenCalled());
		expect(api.change.mock.calls[0][0]).toMatchObject({
			kind: "correct_transfer",
			quantity: 1,
			destinationAssignmentId: "destination",
			expectedDestinationRevision: 4,
			receipt: { actualDate: partialAssignment.receipts[0].actualDate },
			issue: { actualDate: "2026-11-04" },
			reason: "One shirt moved in this transfer",
		});
	});

	it("shows the original records and amendments in a collapsed card without offering corrections to readers", async () => {
		const user = userEvent.setup();
		detail(
			{
				...heldAssignment,
				canReceive: false,
				corrections: [
					{
						id: "correction",
						handoverId: issue.id,
						exceptionId: null,
						expectedRevision: 6,
						reason: "Signed agreement corrected the condition",
						actorId: "admin",
						actorName: "Sam Admin",
						recordedAt: "2026-11-05T09:00:00Z",
						before: { condition: "good", notes: "Original signed evidence" },
						after: { condition: "worn", notes: "Effective signed evidence" },
					},
				],
			},
			{ canManage: false, canAdminister: false },
		);
		expect(
			screen.queryByRole("button", { name: "Correct a record" }),
		).toBeNull();
		expect(screen.queryByText("Original signed evidence")).toBeNull();
		await user.click(
			screen.getByRole("button", { name: /Original records and amendments/ }),
		);
		expect(await screen.findByText("Original signed evidence")).toBeTruthy();
		expect(screen.getByText("Effective signed evidence")).toBeTruthy();
		expect(
			screen.getByText("Signed agreement corrected the condition"),
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Alex Current" })).toBeNull();
	});
});
