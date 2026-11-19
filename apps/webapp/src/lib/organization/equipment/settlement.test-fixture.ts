/** Return settlement cases shared by the unit tests and the SQL agreement test. */
export const SHIRTS = { quantity: 3, returnRequired: true };
const LOSS = { id: "loss", kind: "lost" as const };
const WAIVER = { id: "waiver", kind: "waived" as const };
export const returned = (quantity: number) => ({ quantity, exceptionId: null });
export const recovered = (quantity: number, exceptionId: string) => ({
	quantity,
	exceptionId,
});
export const lost = (quantity: number) => ({ ...LOSS, quantity });
export const waived = (quantity: number) => ({ ...WAIVER, quantity });

/** Expected values are worked out by hand from the glossary, never by the formula. */
export const SETTLED_CASES = [
	{
		name: "partial return",
		terms: SHIRTS,
		receipts: [returned(2)],
		exceptions: [],
		counts: { received: 2, lost: 0, waived: 0, recovered: 0 },
		outstanding: 1,
		receivable: 1,
		fullyReceived: false,
	},
	{
		name: "lost then partly recovered",
		terms: SHIRTS,
		receipts: [returned(1), recovered(1, "loss")],
		exceptions: [lost(2)],
		counts: { received: 2, lost: 2, waived: 0, recovered: 1 },
		outstanding: 0,
		receivable: 0,
		fullyReceived: false,
	},
	{
		name: "recovered against a return waiver",
		terms: { quantity: 2, returnRequired: true },
		receipts: [returned(1), recovered(1, "waiver")],
		exceptions: [waived(1)],
		counts: { received: 2, lost: 0, waived: 1, recovered: 1 },
		outstanding: 0,
		receivable: 0,
		fullyReceived: true,
	},
	{
		name: "partial return waiver",
		terms: { quantity: 4, returnRequired: true },
		receipts: [returned(1)],
		exceptions: [waived(1)],
		counts: { received: 1, lost: 0, waived: 1, recovered: 0 },
		outstanding: 2,
		receivable: 2,
		fullyReceived: false,
	},
	{
		name: "distinct loss and waiver recoveries with a return still outstanding",
		terms: { quantity: 4, returnRequired: true },
		receipts: [returned(1), recovered(1, "loss"), recovered(1, "waiver")],
		exceptions: [lost(1), waived(1)],
		counts: { received: 3, lost: 1, waived: 1, recovered: 2 },
		outstanding: 1,
		receivable: 1,
		fullyReceived: false,
	},
	{
		name: "equipment issued to keep with a voluntary partial receipt",
		terms: { quantity: 3, returnRequired: false },
		receipts: [returned(1)],
		exceptions: [],
		counts: { received: 1, lost: 0, waived: 0, recovered: 0 },
		outstanding: 0,
		receivable: 2,
		fullyReceived: false,
	},
	{
		name: "a transfer receipt after a loss settles without receiving everything",
		terms: SHIRTS,
		receipts: [returned(1)],
		exceptions: [lost(2)],
		counts: { received: 1, lost: 2, waived: 0, recovered: 0 },
		outstanding: 0,
		receivable: 0,
		fullyReceived: false,
	},
	{
		name: "recovering that loss later receives everything",
		terms: SHIRTS,
		receipts: [returned(1), recovered(2, "loss")],
		exceptions: [lost(2)],
		counts: { received: 3, lost: 2, waived: 0, recovered: 2 },
		outstanding: 0,
		receivable: 0,
		fullyReceived: true,
	},
	{
		name: "reversed records count as zero",
		terms: SHIRTS,
		receipts: [returned(0), returned(1)],
		exceptions: [lost(0)],
		counts: { received: 1, lost: 0, waived: 0, recovered: 0 },
		outstanding: 2,
		receivable: 2,
		fullyReceived: false,
	},
];

export const REFUSED_CASES = [
	{
		name: "more recovered against a decision than it closed",
		terms: SHIRTS,
		receipts: [recovered(2, "loss")],
		exceptions: [lost(1)],
		reason: "recovery_conflict",
		counts: { received: 2, lost: 1, waived: 0, recovered: 2 },
	},
	{
		name: "more received than issued",
		terms: SHIRTS,
		receipts: [returned(2), returned(2)],
		exceptions: [],
		reason: "excess_quantity",
		counts: { received: 4, lost: 0, waived: 0, recovered: 0 },
	},
	{
		name: "more returned and closed than issued",
		terms: SHIRTS,
		receipts: [returned(2)],
		exceptions: [waived(2)],
		reason: "excess_quantity",
		counts: { received: 2, lost: 0, waived: 2, recovered: 0 },
	},
	{
		name: "a closure on equipment issued to keep",
		terms: { quantity: 3, returnRequired: false },
		receipts: [],
		exceptions: [lost(1)],
		reason: "excess_quantity",
		counts: { received: 0, lost: 1, waived: 0, recovered: 0 },
	},
];
