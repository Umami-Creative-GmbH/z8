import type { EquipmentAssignmentView } from "@/lib/organization/equipment/contracts";

/** What a correction amends; `id` is the receipt, exception or transfer destination. */
export type CorrectionTarget =
	| { kind: "issue" }
	| { kind: "receipt"; id: string }
	| { kind: "exception"; id: string }
	| { kind: "transfer"; id: string };

/** Every record the reader may amend, numbered within its kind as the history lists them. */
export function correctionTargets(assignment: EquipmentAssignmentView) {
	const numbered = <T>(
		records: readonly T[] | undefined,
		target: (record: T) => CorrectionTarget,
	) =>
		(records ?? []).map((record, index) => ({
			target: target(record),
			index: index + 1,
		}));
	return [
		...(assignment.canCorrect
			? [{ target: { kind: "issue" } as CorrectionTarget, index: 0 }]
			: []),
		...(assignment.canCorrectReceipt
			? numbered(assignment.receipts, (h) => ({ kind: "receipt", id: h.id }))
			: []),
		...(assignment.canCorrectException
			? numbered(assignment.exceptions, (e) => ({
					kind: "exception",
					id: e.id,
				}))
			: []),
		...(assignment.canCorrectReceipt
			? numbered(assignment.correctionTransfers, (e) => ({
					kind: "transfer",
					id: e.destinationAssignmentId,
				}))
			: []),
	];
}
