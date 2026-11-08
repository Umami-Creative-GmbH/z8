import type { ReactivationChecklistItem } from "../reactivation-checklist";
import type {
	AnyEmploymentEndingParticipant,
	EmploymentEndingAfterCommit,
	EmploymentEndingAppliedOf,
	EmploymentEndingContext,
	EmploymentEndingPlanContext,
	EmploymentEndingPlanOf,
	EmploymentEndingReader,
	EmploymentEndingWriter,
} from "./types";

/**
 * Employment ending (#1624, spec #1590) over a fixed list of participants.
 * The module owns their order: each participant plans and ends its holdings
 * before the next one starts, inside the cause's transaction. The cause calls
 * `endEmployment` after its lifecycle locks and after write-locking the
 * employee row, before it switches the employee off. External effects come
 * back as after-commit steps, in participant order.
 */
export function createEmploymentEnding<const P extends readonly AnyEmploymentEndingParticipant[]>(
	participants: P,
) {
	const keys = new Set<string>();
	for (const participant of participants) {
		if (keys.has(participant.key)) {
			throw new Error(`Two employment ending participants share the key "${participant.key}"`);
		}
		keys.add(participant.key);
	}

	return {
		/** Ends everything the employee holds; a second run ends nothing. */
		async endEmployment(
			tx: EmploymentEndingWriter,
			ctx: EmploymentEndingContext,
		): Promise<{
			applied: EmploymentEndingAppliedOf<P>;
			afterCommit: EmploymentEndingAfterCommit[];
		}> {
			const applied: Record<string, unknown> = {};
			const afterCommit: EmploymentEndingAfterCommit[] = [];
			// One after another: inside the transaction the client is a single connection.
			for (const participant of participants) {
				const plan = await participant.plan(tx, ctx);
				const result = await participant.apply(tx, plan, ctx);
				applied[participant.key] = result.applied;
				afterCommit.push(...(result.afterCommit ?? []));
			}
			return { applied: applied as EmploymentEndingAppliedOf<P>, afterCommit };
		},

		/** What `endEmployment` would end now, per participant. Reads only. */
		async previewEmploymentEnding(
			reader: EmploymentEndingReader,
			ctx: EmploymentEndingPlanContext,
		): Promise<EmploymentEndingPlanOf<P>> {
			const plan: Record<string, unknown> = {};
			for (const participant of participants) {
				plan[participant.key] = await participant.plan(reader, ctx);
			}
			return plan as EmploymentEndingPlanOf<P>;
		},

		/**
		 * The reactivation checklist items for what was ended. A participant
		 * missing from `applied` (an ending recorded before it existed) has none.
		 */
		reactivationItems(
			applied: Partial<EmploymentEndingAppliedOf<P>>,
			subject: { employeeId: string },
		): ReactivationChecklistItem[] {
			const recorded = applied as Record<string, unknown>;
			return participants.flatMap((participant) =>
				recorded[participant.key] === undefined
					? []
					: participant.reactivationItems(recorded[participant.key], subject),
			);
		},
	};
}
