import "server-only";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import {
	employee,
	employeeDeactivation,
	employeeEmploymentPeriod,
} from "@/db/schema";
import {
	equipmentAssignment,
	equipmentCorrection,
	equipmentException,
	equipmentHandover,
	equipmentItem,
	equipmentItemCustodyHistory,
	equipmentItemReadinessEvent,
	equipmentTransfer,
} from "@/db/schema/equipment";
import {
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	type EquipmentActor,
	equipmentAccess,
	equipmentCoversAssignment,
	equipmentItemScope,
} from "./access";
import type {
	EquipmentChange,
	EquipmentOutcome,
	EquipmentRefusal,
} from "./contracts";
import { equipmentDepartureDeadline } from "./deadlines";
import { readEquipmentEndingContexts } from "./endings";
import type { EquipmentTransaction } from "./setup";

type Handover = typeof equipmentHandover.$inferSelect;
type Exception = typeof equipmentException.$inferSelect;
export const effectiveHandover = <T extends Handover>(record: T): T => ({
	...record,
	...record.effective,
});
export const effectiveException = <T extends Exception>(record: T): T => ({
	...record,
	...record.effective,
});
export type CorrectionChange = Extract<
	EquipmentChange,
	{ kind: "correct_issue" | "correct_receipt" | "correct_exception" }
>;
const refused = (reason: EquipmentRefusal): EquipmentOutcome => ({
	ok: false,
	reason,
});
const assignmentWhere = (organizationId: string, id: string) =>
	and(
		eq(equipmentAssignment.organizationId, organizationId),
		eq(equipmentAssignment.id, id),
	);
const earlier = (a: string, b: string) =>
	Temporal.PlainDate.compare(parsePlainDate(a), parsePlainDate(b)) < 0;
function handoverValues(h: Handover) {
	return {
		quantity: h.quantity,
		actualDate: h.actualDate,
		condition: h.condition,
		notes: h.notes,
	};
}

/** Invoked only after the shared live authorization/replay/lock boundary. */
export async function correctEquipment(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	change: CorrectionChange,
	today: Temporal.PlainDate,
	now: Temporal.Instant,
	timezone: string,
	paired?: {
		id: string;
		quantity: number;
		actualDate: string;
		condition: "good" | "worn" | "damaged" | "unknown";
		notes?: string;
	},
): Promise<EquipmentOutcome> {
	const [assignment] = await tx
		.select()
		.from(equipmentAssignment)
		.where(assignmentWhere(actor.organizationId, change.assignmentId));
	if (!assignment?.employeeId) return refused("not_found");
	const access = await equipmentAccess(tx, actor);
	const [holder] = await tx
		.select({
			userId: employee.userId,
			current: employeeHasOrganizationAccess(now),
			deactivatedAt: employee.deactivatedAt,
		})
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, actor.organizationId),
				eq(employee.id, assignment.employeeId),
			),
		);
	const own = holder?.userId === actor.userId;
	if (change.kind === "correct_exception" && !access.canAdminister)
		return refused("forbidden");
	if (change.kind === "correct_exception" && own)
		return refused("self_exception");
	if (change.kind === "correct_receipt" && own) return refused("self_receipt");
	if (assignment.revision !== change.expectedRevision)
		return refused("stale_revision");
	const originalHandovers = await tx
		.select()
		.from(equipmentHandover)
		.where(
			and(
				eq(equipmentHandover.organizationId, actor.organizationId),
				eq(equipmentHandover.assignmentId, assignment.id),
			),
		);
	const handovers = originalHandovers.map(effectiveHandover);
	const exceptions = (
		await tx
			.select()
			.from(equipmentException)
			.where(
				and(
					eq(equipmentException.organizationId, actor.organizationId),
					eq(equipmentException.assignmentId, assignment.id),
				),
			)
	).map(effectiveException);
	const exceptionMap = new Map(exceptions.map((e) => [e.id, e]));
	const issue = handovers.find((h) => h.kind === "issue");
	if (!issue) return refused("conflicting_history");
	let handoverId: string | null = null;
	let exceptionId: string | null = null;
	let before: Record<string, string | number | boolean | null>;
	let after: Record<string, string | number | boolean | null>;
	const proposed = { ...assignment };
	if (change.kind === "correct_exception") {
		const decision = exceptions.find((e) => e.id === change.exceptionId);
		if (!decision) return refused("not_found");
		if (decision.kind !== change.outcome && decision.receivedQuantity > 0)
			return refused("recovery_conflict");
		exceptionId = decision.id;
		before = {
			quantity: decision.quantity,
			kind: decision.kind,
			reason: decision.reason,
		};
		after = {
			quantity: change.quantity,
			kind: change.outcome,
			reason: change.decisionReason,
		};
		Object.assign(decision, after);
	} else {
		const h =
			change.kind === "correct_issue"
				? issue
				: handovers.find(
						(h) => h.id === change.handoverId && h.kind === "receipt",
					);
		if (!h) return refused("not_found");
		if (
			h.transferHistoryCleaned &&
			(change.quantity !== h.quantity || change.actualDate !== h.actualDate)
		)
			return refused("transfer_conflict");
		handoverId = h.id;
		before = handoverValues(h);
		after = {
			quantity: change.quantity,
			actualDate: change.actualDate,
			condition: change.condition,
			notes: change.notes || null,
		};
		if (change.kind === "correct_issue") {
			if (!h.historical && change.actualDate === null)
				return refused("invalid_input");
			if (
				own &&
				((assignment.returnRequired && !change.returnRequired) ||
					change.quantity < assignment.quantity)
			)
				return refused("self_exception");
			if (assignment.returnRequired && !change.returnRequired)
				return refused("waiver_required");
			if (
				change.employmentPeriodId !== assignment.employmentPeriodId &&
				!h.historical
			)
				return refused("conflicting_history");
			if (!change.returnRequired && change.explicitDeadline)
				return refused("invalid_input");
			if (
				change.explicitDeadline &&
				change.actualDate &&
				earlier(change.explicitDeadline, change.actualDate)
			)
				return refused("conflicting_history");
			const periods = await tx
				.select()
				.from(employeeEmploymentPeriod)
				.where(
					and(
						eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
						eq(employeeEmploymentPeriod.employeeId, assignment.employeeId),
					),
				);
			const period = periods.find((p) => p.id === change.employmentPeriodId);
			if (change.employmentPeriodId && !period)
				return refused("conflicting_history");
			if (
				!h.historical &&
				holder &&
				!holder.current &&
				!assignment.deactivationId &&
				!period?.endedAt &&
				change.actualDate
			) {
				const latest = holder.deactivatedAt
					? instantFromDate(holder.deactivatedAt)
							.toZonedDateTimeISO(timezone)
							.toPlainDate()
							.toString()
					: h.actualDate;
				if (!latest || earlier(latest, change.actualDate))
					return refused("employee_not_current");
			}
			// A correction belongs to the original employment. Reassigning it across rehire
			// would detach departure-derived obligations; record a separate historical holding instead.
			if (change.employmentPeriodId !== assignment.employmentPeriodId)
				return refused("conflicting_history");
			// Reactivation can reopen this very period. Its identity alone cannot erase
			// the immutable ending that this older assignment belongs to.
			if (assignment.deactivationId && change.actualDate) {
				const [ending] = await tx
					.select()
					.from(employeeDeactivation)
					.where(
						and(
							eq(employeeDeactivation.organizationId, actor.organizationId),
							eq(employeeDeactivation.id, assignment.deactivationId),
							eq(employeeDeactivation.employeeId, assignment.employeeId),
						),
					);
				if (
					!ending ||
					earlier(
						equipmentDepartureDeadline(
							instantFromDate(ending.deactivatedAt),
							typeof ending.plan?.timeZone === "string"
								? ending.plan.timeZone
								: timezone,
							"immediate",
						),
						change.actualDate,
					)
				)
					return refused("conflicting_history");
			}
			if (period && change.actualDate) {
				const start = parsePlainDate(change.actualDate)
					.toZonedDateTime(timezone)
					.toInstant();
				const end = parsePlainDate(change.actualDate)
					.add({ days: 1 })
					.toZonedDateTime(timezone)
					.toInstant();
				if (
					(period.startedAt &&
						Temporal.Instant.compare(instantFromDate(period.startedAt), end) >=
							0) ||
					(period.endedAt &&
						Temporal.Instant.compare(start, instantFromDate(period.endedAt)) >=
							0)
				)
					return refused("conflicting_history");
			}
			const originalContext = (
				await readEquipmentEndingContexts(
					tx,
					actor.organizationId,
					assignment.employeeId,
					period,
					timezone,
					!period ? (holder?.deactivatedAt ?? null) : null,
				)
			).find((c) =>
				assignment.deactivationId
					? c.deactivationId === assignment.deactivationId
					: !c.deactivationId,
			);
			if (
				!originalContext ||
				(change.actualDate &&
					((originalContext.startedOn &&
						earlier(change.actualDate, originalContext.startedOn)) ||
						(originalContext.endedOn &&
							earlier(originalContext.endedOn, change.actualDate))))
			)
				return refused("conflicting_history");
			before = {
				...before,
				returnRequired: assignment.returnRequired,
				explicitDeadline: assignment.explicitDeadline,
				employmentPeriodId: assignment.employmentPeriodId,
				departureDeadline: assignment.departureDeadline,
				departureId: assignment.departureId,
				deactivationId: assignment.deactivationId,
			};
			after = {
				...after,
				returnRequired: change.returnRequired,
				explicitDeadline: change.explicitDeadline,
				employmentPeriodId: change.employmentPeriodId,
			};
			Object.assign(proposed, {
				quantity: change.quantity,
				returnRequired: change.returnRequired,
				explicitDeadline: change.explicitDeadline,
				departureDeadline: change.returnRequired
					? assignment.departureDeadline
					: null,
				departureId: assignment.departureId,
			});
			// Turning a keep agreement into a required return needs its original ending terms.
			if (!assignment.returnRequired && change.returnRequired) {
				proposed.departureDeadline = originalContext.deadline;
				proposed.departureId = originalContext.departureId;
			}
			after = {
				...after,
				departureDeadline: proposed.departureDeadline,
				departureId: proposed.departureId,
				deactivationId: assignment.deactivationId,
			};
		}
		Object.assign(h, handoverValues({ ...h, ...after }));
	}
	// Validate the whole effective settlement, including all recoveries. No closure
	// or reversal is a physical receipt, and recovered units still belong to a decision.
	for (const h of handovers) {
		if (h.actualDate && earlier(today.toString(), h.actualDate))
			return refused("future_date");
		if (
			h.kind === "receipt" &&
			(!h.actualDate ||
				(issue.actualDate && earlier(h.actualDate, issue.actualDate)))
		)
			return refused("conflicting_history");
		if (h.kind === "receipt" && h.exceptionId) {
			const exception = exceptionMap.get(h.exceptionId);
			if (
				!exception ||
				(h.actualDate &&
					earlier(
						h.actualDate,
						instantFromDate(exception.recordedAt)
							.toZonedDateTimeISO(timezone)
							.toPlainDate()
							.toString(),
					))
			)
				return refused("conflicting_history");
		}
	}
	proposed.receivedQuantity = handovers
		.filter((h) => h.kind === "receipt")
		.reduce((n, h) => n + h.quantity, 0);
	proposed.exceptionReceivedQuantity = handovers
		.filter((h) => h.kind === "receipt" && h.exceptionId)
		.reduce((n, h) => n + h.quantity, 0);
	proposed.lostQuantity = exceptions
		.filter((e) => e.kind === "lost")
		.reduce((n, e) => n + e.quantity, 0);
	proposed.waivedQuantity = exceptions
		.filter((e) => e.kind === "waived")
		.reduce((n, e) => n + e.quantity, 0);
	for (const e of exceptions) {
		e.receivedQuantity = handovers
			.filter((h) => h.exceptionId === e.id)
			.reduce((n, h) => n + h.quantity, 0);
		if (e.receivedQuantity > e.quantity) return refused("recovery_conflict");
	}
	if (
		proposed.receivedQuantity > proposed.quantity ||
		proposed.receivedQuantity +
			proposed.lostQuantity +
			proposed.waivedQuantity -
			proposed.exceptionReceivedQuantity >
			proposed.quantity ||
		(!proposed.returnRequired && exceptions.some((e) => e.quantity > 0)) ||
		(assignment.itemId && proposed.quantity !== 1)
	)
		return refused("excess_quantity");
	proposed.received = proposed.receivedQuantity === proposed.quantity;
	const hIds = handovers.map((h) => h.id);
	const links = await tx
		.select()
		.from(equipmentTransfer)
		.where(
			and(
				eq(equipmentTransfer.organizationId, actor.organizationId),
				or(
					inArray(equipmentTransfer.receiptId, hIds),
					inArray(equipmentTransfer.issueId, hIds),
				),
			),
		);
	if (links.length) {
		const peerIds = [
			...new Set(links.flatMap((l) => [l.receiptId, l.issueId])),
		];
		const peers = (
			await tx
				.select()
				.from(equipmentHandover)
				.where(
					and(
						eq(equipmentHandover.organizationId, actor.organizationId),
						inArray(equipmentHandover.id, peerIds),
					),
				)
		)
			.map(effectiveHandover)
			.map((h) =>
				h.id === paired?.id
					? { ...h, ...paired, notes: paired.notes || null }
					: h,
			);
		const affectedHandovers = new Map(
			[...peers, ...handovers].map((h) => [h.id, h]),
		);
		for (const p of peers) {
			if (p.assignmentId === assignment.id) continue;
			const [other] = await tx
				.select()
				.from(equipmentAssignment)
				.where(assignmentWhere(actor.organizationId, p.assignmentId));
			if (
				!other?.employeeId ||
				!(await equipmentCoversAssignment(tx, actor, access, other.id))
			)
				return refused("forbidden");
			const [otherHolder] = await tx
				.select({ userId: employee.userId })
				.from(employee)
				.where(
					and(
						eq(employee.organizationId, actor.organizationId),
						eq(employee.id, other.employeeId),
					),
				);
			// Amending the destination leg must not certify the actor's source return.
			if (p.kind === "receipt" && otherHolder?.userId === actor.userId)
				return refused("self_receipt");
		}
		for (const link of links) {
			const receipt = affectedHandovers.get(link.receiptId);
			const issued = affectedHandovers.get(link.issueId);
			if (
				!receipt ||
				!issued ||
				receipt.quantity !== issued.quantity ||
				!receipt.actualDate ||
				!issued.actualDate ||
				earlier(issued.actualDate, receipt.actualDate)
			)
				return refused("transfer_conflict");
		}
	}
	let itemUpdate:
		| {
				inCustody: boolean;
				lastHandoverDate: string | null;
				status: "available" | "unavailable" | "retired";
		  }
		| undefined;
	if (assignment.itemId) {
		const [item] = await tx
			.select()
			.from(equipmentItem)
			.where(
				and(
					eq(equipmentItem.organizationId, actor.organizationId),
					eq(equipmentItem.id, assignment.itemId),
					equipmentItemScope(access),
				),
			);
		if (!item) return refused("forbidden");
		const otherAssignments = await tx
			.select()
			.from(equipmentAssignment)
			.where(
				and(
					eq(equipmentAssignment.organizationId, actor.organizationId),
					eq(equipmentAssignment.itemId, item.id),
				),
			);
		const allHandovers = await tx
			.select()
			.from(equipmentHandover)
			.where(
				and(
					eq(equipmentHandover.organizationId, actor.organizationId),
					inArray(
						equipmentHandover.assignmentId,
						otherAssignments.map((a) => a.id),
					),
				),
			)
			.orderBy(asc(equipmentHandover.sequence));
		const issues = allHandovers.filter((h) => h.kind === "issue");
		const cleaned = await tx
			.select()
			.from(equipmentItemCustodyHistory)
			.where(
				and(
					eq(equipmentItemCustodyHistory.organizationId, actor.organizationId),
					eq(equipmentItemCustodyHistory.itemId, item.id),
				),
			);
		// Keep the original custody order even when correcting the actual dates.
		let previousReceipt: string | null = null;
		let lastDate: string | null = null;
		let heldCount = 0;
		const chronology = [
			...issues.map((original) => ({
				sequence: original.sequence,
				original,
				cleaned: undefined,
			})),
			...cleaned.map((row) => ({
				sequence: row.issueSequence,
				original: undefined,
				cleaned: row,
			})),
		].sort((a, b) => a.sequence - b.sequence);
		for (const entry of chronology) {
			if (entry.cleaned) {
				const row = entry.cleaned;
				if (
					heldCount ||
					(previousReceipt &&
						(!row.issueDate || earlier(row.issueDate, previousReceipt)))
				)
					return refused("conflicting_history");
				if (!row.receiptDate) heldCount++;
				previousReceipt = row.receiptDate;
				lastDate = row.receiptDate ?? row.issueDate;
				continue;
			}
			const original = entry.original;
			if (!original) throw new Error("Missing item history boundary");
			const effectiveIssue =
				original.assignmentId === assignment.id
					? issue
					: effectiveHandover(original);
			const issued =
				effectiveIssue.id === paired?.id
					? { ...effectiveIssue, ...paired }
					: effectiveIssue;
			const receipts =
				original.assignmentId === assignment.id
					? handovers.filter((h) => h.kind === "receipt" && h.quantity > 0)
					: allHandovers
							.filter(
								(h) =>
									h.assignmentId === original.assignmentId &&
									h.kind === "receipt",
							)
							.map(effectiveHandover)
							.filter((h) => h.quantity > 0);
			if (
				heldCount ||
				(previousReceipt &&
					(!issued.actualDate || earlier(issued.actualDate, previousReceipt)))
			)
				return refused("conflicting_history");
			const received = receipts[0];
			if (
				received &&
				issued.actualDate &&
				received.actualDate &&
				earlier(received.actualDate, issued.actualDate)
			)
				return refused("conflicting_history");
			if (!received) heldCount++;
			previousReceipt = received?.actualDate ?? null;
			lastDate = received?.actualDate ?? issued.actualDate;
		}
		const changed = handovers.find(
			(h) => h.id === handoverId && h.kind === "receipt",
		);
		const original = originalHandovers.find((h) => h.id === handoverId);
		const prior = original && effectiveHandover(original);
		const readiness = await tx
			.select()
			.from(equipmentItemReadinessEvent)
			.where(
				and(
					eq(equipmentItemReadinessEvent.organizationId, actor.organizationId),
					eq(equipmentItemReadinessEvent.itemId, item.id),
				),
			);
		let status = item.status;
		if (changed && prior && changed.condition !== prior.condition) {
			if (
				readiness.some(
					(e) =>
						e.kind === "clearance" &&
						Temporal.Instant.compare(
							instantFromDate(e.recordedAt),
							instantFromDate(prior.recordedAt),
						) >= 0,
				)
			)
				return refused("readiness_conflict");
			if (changed.condition === "damaged") {
				if (issues.some((h) => h.sequence > issue.sequence))
					return refused("readiness_conflict");
				if (status !== "retired") status = "unavailable";
			}
		}
		itemUpdate = {
			inCustody: heldCount > 0,
			lastHandoverDate: lastDate,
			status,
		};
	}
	// All validation precedes writes; refusals cannot leave half an amendment.
	if (handoverId) {
		const h = handovers.find((h) => h.id === handoverId);
		if (!h) throw new Error("Missing validated amendment evidence");
		await tx
			.update(equipmentHandover)
			.set({ effective: handoverValues(h) })
			.where(
				and(
					eq(equipmentHandover.organizationId, actor.organizationId),
					eq(equipmentHandover.id, h.id),
				),
			);
	}
	for (const e of exceptions)
		await tx
			.update(equipmentException)
			.set({
				effective: { kind: e.kind, quantity: e.quantity, reason: e.reason },
				receivedQuantity: e.receivedQuantity,
			})
			.where(
				and(
					eq(equipmentException.organizationId, actor.organizationId),
					eq(equipmentException.id, e.id),
				),
			);
	await tx
		.update(equipmentAssignment)
		.set({
			quantity: proposed.quantity,
			returnRequired: proposed.returnRequired,
			explicitDeadline: proposed.explicitDeadline,
			departureDeadline: proposed.departureDeadline,
			departureId: proposed.departureId,
			receivedQuantity: proposed.receivedQuantity,
			exceptionReceivedQuantity: proposed.exceptionReceivedQuantity,
			lostQuantity: proposed.lostQuantity,
			waivedQuantity: proposed.waivedQuantity,
			received: proposed.received,
			revision: assignment.revision + 1,
		})
		.where(assignmentWhere(actor.organizationId, assignment.id));
	if (assignment.itemId && itemUpdate) {
		const [item] = await tx
			.select()
			.from(equipmentItem)
			.where(
				and(
					eq(equipmentItem.organizationId, actor.organizationId),
					eq(equipmentItem.id, assignment.itemId),
				),
			);
		await tx
			.update(equipmentItem)
			.set({
				...itemUpdate,
				revision: item.revision + 1,
				updatedBy: actor.userId,
				updatedAt: dateFromInstant(now),
			})
			.where(
				and(
					eq(equipmentItem.organizationId, actor.organizationId),
					eq(equipmentItem.id, item.id),
				),
			);
	}
	await tx.insert(equipmentCorrection).values({
		organizationId: actor.organizationId,
		assignmentId: assignment.id,
		handoverId,
		exceptionId,
		expectedRevision: change.expectedRevision,
		reason: change.reason,
		before,
		after,
		actorId: actor.userId,
		recordedAt: dateFromInstant(now),
	});
	return { ok: true, id: assignment.id, revision: assignment.revision + 1 };
}

class CorrectionRefusal extends Error {
	constructor(readonly outcome: Extract<EquipmentOutcome, { ok: false }>) {
		super("Equipment correction refused");
	}
}
export function correctionRefusal(
	error: unknown,
): EquipmentOutcome | undefined {
	return error instanceof CorrectionRefusal ? error.outcome : undefined;
}
/** Atomic linked amendment; a failure of either leg rolls both back. */
export async function correctEquipmentTransfer(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	change: Extract<EquipmentChange, { kind: "correct_transfer" }>,
	today: Temporal.PlainDate,
	now: Temporal.Instant,
	timezone: string,
): Promise<EquipmentOutcome> {
	const hs = await tx
		.select()
		.from(equipmentHandover)
		.where(
			and(
				eq(equipmentHandover.organizationId, actor.organizationId),
				inArray(equipmentHandover.assignmentId, [
					change.assignmentId,
					change.destinationAssignmentId,
				]),
			),
		);
	const issue = hs.find(
		(h) =>
			h.assignmentId === change.destinationAssignmentId && h.kind === "issue",
	);
	const links = issue
		? await tx
				.select()
				.from(equipmentTransfer)
				.where(
					and(
						eq(equipmentTransfer.organizationId, actor.organizationId),
						eq(equipmentTransfer.issueId, issue.id),
					),
				)
		: [];
	const receipt = hs.find(
		(h) =>
			h.assignmentId === change.assignmentId &&
			links.some((l) => l.receiptId === h.id),
	);
	const [destination] = await tx
		.select()
		.from(equipmentAssignment)
		.where(
			assignmentWhere(actor.organizationId, change.destinationAssignmentId),
		);
	if (!destination || !issue || !receipt) return refused("transfer_conflict");
	const current = effectiveHandover(issue);
	const common = {
		requestId: change.requestId,
		reason: change.reason,
		quantity: change.quantity,
	};
	const first = await correctEquipment(
		tx,
		actor,
		{
			...common,
			...change.receipt,
			kind: "correct_receipt",
			assignmentId: change.assignmentId,
			handoverId: receipt.id,
			expectedRevision: change.expectedRevision,
		},
		today,
		now,
		timezone,
		{ ...change.issue, id: issue.id, quantity: change.quantity },
	);
	if (!first.ok) throw new CorrectionRefusal(first);
	const second = await correctEquipment(
		tx,
		actor,
		{
			...common,
			...change.issue,
			kind: "correct_issue",
			assignmentId: destination.id,
			expectedRevision: change.expectedDestinationRevision,
			returnRequired: destination.returnRequired,
			explicitDeadline: destination.explicitDeadline,
			employmentPeriodId: destination.employmentPeriodId,
			notes: change.issue.notes ?? current.notes ?? "",
		},
		today,
		now,
		timezone,
	);
	if (!second.ok) throw new CorrectionRefusal(second);
	return first;
}

/** Rechecked before replay too, so a previous transfer result does not outlive peer scope. */
export async function canCorrectEquipmentHistory(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	access: Awaited<ReturnType<typeof equipmentAccess>>,
	assignmentId: string,
): Promise<boolean> {
	const [a] = await tx
		.select()
		.from(equipmentAssignment)
		.where(assignmentWhere(actor.organizationId, assignmentId));
	if (
		!a?.employeeId ||
		!access.canManage ||
		!(await equipmentCoversAssignment(tx, actor, access, a.id))
	)
		return false;
	if (a.itemId) {
		const [covered] = await tx
			.select({ id: equipmentItem.id })
			.from(equipmentItem)
			.where(
				and(
					eq(equipmentItem.organizationId, actor.organizationId),
					eq(equipmentItem.id, a.itemId),
					equipmentItemScope(access),
				),
			);
		if (!covered) return false;
	}
	const hs = await tx
		.select({ id: equipmentHandover.id })
		.from(equipmentHandover)
		.where(
			and(
				eq(equipmentHandover.organizationId, actor.organizationId),
				eq(equipmentHandover.assignmentId, a.id),
			),
		);
	if (!hs.length) return false;
	const ids = hs.map((h) => h.id);
	const links = await tx
		.select()
		.from(equipmentTransfer)
		.where(
			and(
				eq(equipmentTransfer.organizationId, actor.organizationId),
				or(
					inArray(equipmentTransfer.receiptId, ids),
					inArray(equipmentTransfer.issueId, ids),
				),
			),
		);
	if (!links.length) return true;
	const peers = await tx
		.select({
			id: equipmentAssignment.id,
			employeeId: equipmentAssignment.employeeId,
		})
		.from(equipmentHandover)
		.innerJoin(
			equipmentAssignment,
			and(
				eq(
					equipmentAssignment.organizationId,
					equipmentHandover.organizationId,
				),
				eq(equipmentAssignment.id, equipmentHandover.assignmentId),
			),
		)
		.where(
			and(
				eq(equipmentHandover.organizationId, actor.organizationId),
				inArray(equipmentHandover.id, [
					...new Set(links.flatMap((l) => [l.receiptId, l.issueId])),
				]),
			),
		);
	for (const p of peers)
		if (
			!p.employeeId ||
			!(await equipmentCoversAssignment(tx, actor, access, p.id))
		)
			return false;
	return true;
}
