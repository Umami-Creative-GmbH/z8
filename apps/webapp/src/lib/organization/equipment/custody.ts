import "server-only";
import { createHash } from "node:crypto";
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	sql,
} from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db as database } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	employee,
	employeeDeactivation,
	employeeDeparture,
	employeeEmploymentPeriod,
} from "@/db/schema";
import {
	equipmentAssignment,
	equipmentCommand,
	equipmentException,
	equipmentHandover,
	equipmentItem,
	equipmentPolicy,
	equipmentType,
} from "@/db/schema/equipment";
import {
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { AuthorizationError } from "@/lib/effect/errors";
import {
	employeeHasOrganizationAccess,
	resolveEmployeeOrganizationAccess,
} from "@/lib/employee-lifecycle/access";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import {
	type EquipmentAssignmentView,
	type EquipmentChange,
	type EquipmentExceptionView,
	type EquipmentFilters,
	type EquipmentHandoverView,
	type EquipmentOutcome,
	type EquipmentView,
	equipmentChangeSchema,
} from "./contracts";
import {
	effectiveEquipmentDeadline,
	equipmentDepartureDeadline,
} from "./deadlines";
import { applyItemReadiness, readItemReadiness } from "./readiness";
import {
	type EquipmentTransaction,
	prepareEquipmentTypeForIssuance,
} from "./setup";

const scoped = (organizationId: string, id: string) =>
	and(
		eq(equipmentItem.organizationId, organizationId),
		eq(equipmentItem.id, id),
	);
const assignmentScope = (organizationId: string, id: string) =>
	and(
		eq(equipmentAssignment.organizationId, organizationId),
		eq(equipmentAssignment.id, id),
	);

import {
	type EquipmentActor,
	equipmentAccess,
	equipmentCoversEmployee,
	equipmentItemScope,
	equipmentSubjectScope,
	lockEquipmentContext,
} from "./access";

export type { EquipmentActor } from "./access";

async function organizationCalendar(
	tx: EquipmentTransaction,
	organizationId: string,
) {
	const [org] = await tx
		.select({
			timezone: organization.timezone,
			policyOrganizationId: equipmentPolicy.organizationId,
		})
		.from(organization)
		.leftJoin(
			equipmentPolicy,
			eq(equipmentPolicy.organizationId, organization.id),
		)
		.where(eq(organization.id, organizationId));
	const timezone = resolveOrganizationTimezone(org?.timezone).timezone;
	const now = systemClock.nowInstant();
	return {
		timezone,
		now,
		policyConfigured: !!org?.policyOrganizationId,
		today: now.toZonedDateTimeISO(timezone).toPlainDate(),
	};
}

/** The command boundary owns authorization, replay, chronology and all writes together. */
export async function applyEquipmentChange(
	db: typeof database,
	actor: EquipmentActor,
	input: unknown,
): Promise<EquipmentOutcome> {
	const parsed = equipmentChangeSchema.safeParse(input);
	if (!parsed.success) return { ok: false, reason: "invalid_input" };
	const change = parsed.data;
	const fingerprint = createHash("sha256")
		.update(JSON.stringify({ actor: actor.userId, change }))
		.digest("hex");
	return db
		.transaction(async (tx): Promise<EquipmentOutcome> => {
			// Route before locks, then confirm under them. Employee user identity must not drift.
			const [target] =
				change.kind === "record_historical_individual" ||
				change.kind === "record_historical_quantity" ||
				change.kind === "register_historical_individual" ||
				change.kind === "issue_individual" ||
				change.kind === "issue_quantity" ||
				change.kind === "register_and_issue_individual" ||
				change.kind === "transfer_equipment"
					? await tx
							.select({ id: employee.id, userId: employee.userId })
							.from(employee)
							.where(
								and(
									eq(employee.organizationId, actor.organizationId),
									eq(employee.id, change.employeeId),
								),
							)
					: [];
			await lockEquipmentContext(tx, actor, target);
			const access = await equipmentAccess(tx, actor);
			if (
				!access.canManage ||
				(change.kind === "close_return" && !access.canAdminister)
			)
				return { ok: false, reason: "forbidden" };
			if (
				change.kind === "clear_item" ||
				change.kind === "mark_item_unavailable" ||
				change.kind === "retire_item"
			) {
				const [covered] = await tx
					.select({ id: equipmentItem.id })
					.from(equipmentItem)
					.where(
						and(
							scoped(actor.organizationId, change.itemId),
							equipmentItemScope(access),
						),
					);
				if (!covered)
					return { ok: false, reason: access.all ? "not_found" : "forbidden" };
			} else {
				const subjectId =
					change.kind === "record_historical_individual" ||
					change.kind === "record_historical_quantity" ||
					change.kind === "register_historical_individual" ||
					change.kind === "issue_individual" ||
					change.kind === "issue_quantity" ||
					change.kind === "register_and_issue_individual" ||
					change.kind === "transfer_equipment"
						? change.employeeId
						: (
								await tx
									.select({ employeeId: equipmentAssignment.employeeId })
									.from(equipmentAssignment)
									.where(
										assignmentScope(actor.organizationId, change.assignmentId),
									)
							)[0]?.employeeId;
				const sourceId =
					change.kind === "transfer_equipment"
						? (
								await tx
									.select({ employeeId: equipmentAssignment.employeeId })
									.from(equipmentAssignment)
									.where(
										assignmentScope(actor.organizationId, change.assignmentId),
									)
							)[0]?.employeeId
						: subjectId;
				if (
					!subjectId ||
					!sourceId ||
					!(await equipmentCoversEmployee(tx, actor, access, subjectId)) ||
					(sourceId !== subjectId &&
						!(await equipmentCoversEmployee(tx, actor, access, sourceId)))
				)
					return {
						ok: false,
						reason: access.canAdminister ? "not_found" : "forbidden",
					};
			}
			const [replay] = await tx
				.select()
				.from(equipmentCommand)
				.where(
					and(
						eq(equipmentCommand.organizationId, actor.organizationId),
						eq(equipmentCommand.requestId, change.requestId),
					),
				);
			if (replay)
				return replay.fingerprint === fingerprint
					? replay.result
					: { ok: false, reason: "request_conflict" };
			const { today, now } = await organizationCalendar(
				tx,
				actor.organizationId,
			);
			if (
				change.kind === "clear_item" ||
				change.kind === "mark_item_unavailable" ||
				change.kind === "retire_item"
			) {
				const outcome = await applyItemReadiness(
					tx,
					actor,
					change,
					dateFromInstant(now),
				);
				if (outcome.ok)
					await tx.insert(equipmentCommand).values({
						organizationId: actor.organizationId,
						requestId: change.requestId,
						fingerprint,
						result: outcome,
					});
				return outcome;
			}
			const outcome =
				change.kind === "close_return"
					? await closeEquipmentReturn(tx, actor, change, now)
					: change.kind === "transfer_equipment"
						? await transferEquipment(tx, actor, change, target, today, now)
						: await performHandover(tx, actor, change, target, today, now);
			if (!outcome.ok) return outcome;
			await tx.insert(equipmentCommand).values({
				organizationId: actor.organizationId,
				requestId: change.requestId,
				fingerprint,
				result: outcome,
			});
			return outcome;
		})
		.catch((error: unknown) => {
			if (error instanceof TransferRefusal) return error.outcome;
			throw error;
		});
}

type HandoverChange = Extract<
	EquipmentChange,
	{
		kind:
			| "record_historical_individual"
			| "record_historical_quantity"
			| "register_historical_individual"
			| "register_and_issue_individual"
			| "issue_individual"
			| "issue_quantity"
			| "receive_individual"
			| "receive_quantity"
			| "receive_exception";
	}
>;
type HandoverTarget = { id: string; userId: string } | undefined;

async function closeEquipmentReturn(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	change: Extract<EquipmentChange, { kind: "close_return" }>,
	now: Temporal.Instant,
): Promise<EquipmentOutcome> {
	const [assignment] = await tx
		.select()
		.from(equipmentAssignment)
		.where(assignmentScope(actor.organizationId, change.assignmentId));
	if (!assignment) return { ok: false, reason: "not_found" };
	const [holder] = await tx
		.select({ userId: employee.userId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, actor.organizationId),
				eq(
					employee.id,
					assignment.employeeId ?? "00000000-0000-0000-0000-000000000000",
				),
			),
		);
	if (holder?.userId === actor.userId)
		return { ok: false, reason: "self_exception" };
	if (assignment.revision !== change.expectedRevision)
		return { ok: false, reason: "stale_revision" };
	if (!assignment.returnRequired)
		return { ok: false, reason: "return_not_required" };
	if (
		change.quantity >
		assignment.quantity -
			assignment.receivedQuantity -
			assignment.lostQuantity -
			assignment.waivedQuantity +
			assignment.exceptionReceivedQuantity
	)
		return { ok: false, reason: "excess_quantity" };
	await tx.insert(equipmentException).values({
		organizationId: actor.organizationId,
		assignmentId: assignment.id,
		kind: change.outcome,
		quantity: change.quantity,
		reason: change.reason,
		actorId: actor.userId,
		recordedAt: dateFromInstant(now),
	});
	const revision = assignment.revision + 1;
	await tx
		.update(equipmentAssignment)
		.set({
			lostQuantity:
				assignment.lostQuantity +
				(change.outcome === "lost" ? change.quantity : 0),
			waivedQuantity:
				assignment.waivedQuantity +
				(change.outcome === "waived" ? change.quantity : 0),
			revision,
		})
		.where(assignmentScope(actor.organizationId, assignment.id));
	const outcome = { ok: true, id: assignment.id, revision } as const;
	return outcome;
}

class TransferRefusal extends Error {
	constructor(readonly outcome: Extract<EquipmentOutcome, { ok: false }>) {
		super("Equipment transfer refused");
	}
}

/** No second public writer: both legs use the normal rules under one lock/replay boundary. */
async function transferEquipment(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	change: Extract<EquipmentChange, { kind: "transfer_equipment" }>,
	target: HandoverTarget,
	today: Temporal.PlainDate,
	now: Temporal.Instant,
): Promise<EquipmentOutcome> {
	if (
		Temporal.PlainDate.compare(
			parsePlainDate(change.issue.actualDate),
			parsePlainDate(change.receipt.actualDate),
		) < 0
	)
		return { ok: false, reason: "conflicting_history" };
	const [source] = await tx
		.select()
		.from(equipmentAssignment)
		.where(assignmentScope(actor.organizationId, change.assignmentId));
	if (!source) return { ok: false, reason: "not_found" };
	if (source.employeeId === change.employeeId)
		return { ok: false, reason: "invalid_input" };
	if (source.itemId && change.quantity !== 1)
		return { ok: false, reason: "excess_quantity" };
	const [item] = source.itemId
		? await tx
				.select()
				.from(equipmentItem)
				.where(scoped(actor.organizationId, source.itemId))
		: [];
	const [type] = await tx
		.select()
		.from(equipmentType)
		.where(
			and(
				eq(equipmentType.organizationId, actor.organizationId),
				eq(equipmentType.id, source.typeId),
			),
		);
	if (!type || (source.itemId && !item))
		return { ok: false, reason: "not_found" };
	if ((item?.revision ?? type.revision) !== change.expectedIssuanceRevision)
		return { ok: false, reason: "stale_revision" };
	const receipt = await performHandover(
		tx,
		actor,
		{
			...change.receipt,
			requestId: change.requestId,
			expectedRevision: change.expectedRevision,
			assignmentId: source.id,
			...(source.itemId
				? { kind: "receive_individual" }
				: { kind: "receive_quantity", quantity: change.quantity }),
		},
		target,
		today,
		now,
	);
	if (!receipt.ok) throw new TransferRefusal(receipt);
	const common = {
		...change.issue,
		requestId: change.requestId,
		employeeId: change.employeeId,
	};
	const issued = await performHandover(
		tx,
		actor,
		item
			? {
					...common,
					kind: "issue_individual",
					itemId: item.id,
					expectedRevision: item.revision + 1,
				}
			: {
					...common,
					kind: "issue_quantity",
					typeId: type.id,
					quantity: change.quantity,
					expectedRevision: type.revision,
				},
		target,
		today,
		now,
	);
	if (!issued.ok) throw new TransferRefusal(issued);
	return issued;
}

/** Transaction primitive shared by ordinary handovers and both transfer legs. */
async function performHandover(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	change: HandoverChange,
	target: HandoverTarget,
	today: Temporal.PlainDate,
	now: Temporal.Instant,
): Promise<EquipmentOutcome> {
	const historical =
		change.kind === "record_historical_individual" ||
		change.kind === "record_historical_quantity" ||
		change.kind === "register_historical_individual";
	const individual =
		change.kind === "issue_individual" ||
		change.kind === "record_historical_individual";
	const quantityIssue =
		change.kind === "issue_quantity" ||
		change.kind === "record_historical_quantity";
	const registration =
		change.kind === "register_and_issue_individual" ||
		change.kind === "register_historical_individual";
	const actualDate =
		change.actualDate === null ? null : parsePlainDate(change.actualDate);
	if (actualDate && Temporal.PlainDate.compare(actualDate, today) > 0)
		return { ok: false, reason: "future_date" };
	const recordedAt = dateFromInstant(now);
	let result: { id: string; revision: number };
	if (individual || quantityIssue || registration) {
		if (!change.returnRequired && change.explicitDeadline)
			return { ok: false, reason: "invalid_input" };
		if (
			change.explicitDeadline &&
			actualDate &&
			Temporal.PlainDate.compare(
				parsePlainDate(change.explicitDeadline),
				actualDate,
			) < 0
		)
			return { ok: false, reason: "conflicting_history" };
		const [current] = await tx
			.select({
				userId: employee.userId,
				current: employeeHasOrganizationAccess(now),
				deactivatedAt: employee.deactivatedAt,
			})
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, actor.organizationId),
					eq(employee.id, change.employeeId),
				),
			);
		if (!current || !target || current.userId !== target.userId)
			return { ok: false, reason: "not_found" };
		const employeeAccess = await resolveEmployeeOrganizationAccess(tx, {
			organizationId: actor.organizationId,
			userId: current.userId,
			now,
		});
		if (!historical && (!current.current || !employeeAccess.allowed))
			return { ok: false, reason: "employee_not_current" };
		const periods = await tx
			.select()
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
					eq(employeeEmploymentPeriod.employeeId, change.employeeId),
				),
			);
		const { timezone } = await organizationCalendar(tx, actor.organizationId);
		const dayStart = actualDate?.toZonedDateTime(timezone).toInstant();
		const dayEnd = actualDate
			?.add({ days: 1 })
			.toZonedDateTime(timezone)
			.toInstant();
		const candidates = historical
			? periods.filter(
					(period) =>
						(!change.employmentPeriodId ||
							period.id === change.employmentPeriodId) &&
						(!dayStart ||
							!dayEnd ||
							((!period.startedAt ||
								Temporal.Instant.compare(
									instantFromDate(period.startedAt),
									dayEnd,
								) < 0) &&
								(!period.endedAt ||
									Temporal.Instant.compare(
										dayStart,
										instantFromDate(period.endedAt),
									) < 0))),
				)
			: periods.filter((period) => period.status === "open");
		// Unknown dates never silently attach old equipment to a later rehire period.
		if (
			historical &&
			(candidates.length > 1 ||
				(periods.length > 0 && candidates.length === 0) ||
				(change.employmentPeriodId && candidates.length === 0))
		)
			return { ok: false, reason: "conflicting_history" };
		const period = candidates[0];
		let [item] = individual
			? await tx
					.select()
					.from(equipmentItem)
					.where(scoped(actor.organizationId, change.itemId))
			: [];
		if (individual) {
			if (!item) return { ok: false, reason: "not_found" };
			if (item.revision !== change.expectedRevision)
				return { ok: false, reason: "stale_revision" };
			if (item.archivedAt || item.inCustody || item.status !== "available")
				return { ok: false, reason: "item_unavailable" };
			if (
				item.lastHandoverDate &&
				(!actualDate ||
					Temporal.PlainDate.compare(
						actualDate,
						parsePlainDate(item.lastHandoverDate),
					) < 0)
			)
				return { ok: false, reason: "conflicting_history" };
		}
		const typeId = quantityIssue || registration ? change.typeId : item?.typeId;
		if (!typeId) return { ok: false, reason: "not_found" };
		const [type] = await tx
			.select()
			.from(equipmentType)
			.where(
				and(
					eq(equipmentType.organizationId, actor.organizationId),
					eq(equipmentType.id, typeId),
				),
			);
		if (!type) return { ok: false, reason: "not_found" };
		if (quantityIssue && type.revision !== change.expectedRevision)
			return { ok: false, reason: "stale_revision" };
		if (type.trackingMode !== (quantityIssue ? "quantity" : "individual"))
			return {
				ok: false,
				reason: quantityIssue ? "quantity_required" : "individual_required",
			};
		if (registration) {
			const [duplicate] = await tx
				.select({ id: equipmentItem.id })
				.from(equipmentItem)
				.where(
					and(
						eq(equipmentItem.organizationId, actor.organizationId),
						sql`${equipmentItem.identifierKey} = lower(regexp_replace(${change.identifier}, '^[[:space:]]+|[[:space:]]+$', '', 'g'))`,
					),
				);
			if (duplicate) return { ok: false, reason: "identifier_taken" };
		}
		const prepared = await prepareEquipmentTypeForIssuance(tx, {
			organizationId: actor.organizationId,
			typeId,
		});
		if (!prepared.ok) return prepared;
		if (registration) {
			[item] = await tx
				.insert(equipmentItem)
				.values({
					organizationId: actor.organizationId,
					typeId,
					identifier: change.identifier,
					serialNumber: change.serialNumber || null,
					createdBy: actor.userId,
					updatedBy: actor.userId,
					createdAt: recordedAt,
					updatedAt: recordedAt,
				})
				.returning();
		}
		const quantity = quantityIssue ? change.quantity : 1;
		const [departure] = period
			? await tx
					.select()
					.from(employeeDeparture)
					.where(
						and(
							eq(employeeDeparture.organizationId, actor.organizationId),
							eq(employeeDeparture.employeeId, change.employeeId),
							eq(employeeDeparture.employmentPeriodId, period.id),
							inArray(
								employeeDeparture.status,
								historical ? ["pending", "blocked", "effective"] : ["pending"],
							),
						),
					)
			: [];
		const endingDeadline = departure
			? equipmentDepartureDeadline(
					instantFromDate(departure.cutoffAt),
					departure.timezone,
					departure.mode,
				)
			: historical
				? await historicalEndingDeadline(
						tx,
						actor.organizationId,
						change.employeeId,
						period?.id ?? null,
						timezone,
						!period ? current.deactivatedAt : null,
					)
				: null;
		const [assignment] = await tx
			.insert(equipmentAssignment)
			.values({
				organizationId: actor.organizationId,
				itemId: item?.id ?? null,
				typeId,
				quantity,
				employeeId: change.employeeId,
				employmentPeriodId: period?.id ?? null,
				returnRequired: change.returnRequired,
				explicitDeadline: change.explicitDeadline ?? null,
				departureDeadline: change.returnRequired ? endingDeadline : null,
				departureId: change.returnRequired ? (departure?.id ?? null) : null,
			})
			.returning();
		await tx.insert(equipmentHandover).values({
			organizationId: actor.organizationId,
			assignmentId: assignment.id,
			kind: "issue",
			quantity,
			actualDate: change.actualDate,
			historical,
			condition: change.condition,
			notes: change.notes || null,
			actorId: actor.userId,
			recordedAt,
		});
		if (item)
			await tx
				.update(equipmentItem)
				.set({
					inCustody: true,
					lastHandoverDate: change.actualDate,
					revision: item.revision + 1,
					updatedBy: actor.userId,
					updatedAt: recordedAt,
				})
				.where(scoped(actor.organizationId, item.id));
		result = assignment;
	} else {
		const [assignment] = await tx
			.select()
			.from(equipmentAssignment)
			.where(assignmentScope(actor.organizationId, change.assignmentId));
		if (!assignment) return { ok: false, reason: "not_found" };
		if (
			change.kind !== "receive_exception" &&
			(change.kind === "receive_individual") !== (assignment.itemId !== null)
		)
			return {
				ok: false,
				reason: assignment.itemId ? "individual_required" : "quantity_required",
			};
		const [holder] = await tx
			.select({ userId: employee.userId })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, actor.organizationId),
					eq(
						employee.id,
						assignment.employeeId ?? "00000000-0000-0000-0000-000000000000",
					),
				),
			);
		if (holder?.userId === actor.userId)
			return { ok: false, reason: "self_receipt" };
		if (assignment.revision !== change.expectedRevision)
			return { ok: false, reason: "stale_revision" };
		if (assignment.received) return { ok: false, reason: "already_received" };
		const quantity = change.kind === "receive_individual" ? 1 : change.quantity;
		const [exception] =
			change.kind === "receive_exception"
				? await tx
						.select()
						.from(equipmentException)
						.where(
							and(
								eq(equipmentException.organizationId, actor.organizationId),
								eq(equipmentException.assignmentId, assignment.id),
								eq(equipmentException.id, change.exceptionId),
							),
						)
				: [];
		if (change.kind === "receive_exception") {
			const { timezone } = await organizationCalendar(tx, actor.organizationId);
			if (!exception) return { ok: false, reason: "not_found" };
			if (quantity > exception.quantity - exception.receivedQuantity)
				return { ok: false, reason: "excess_quantity" };
			if (
				Temporal.PlainDate.compare(
					parsePlainDate(change.actualDate),
					instantFromDate(exception.recordedAt)
						.toZonedDateTimeISO(timezone)
						.toPlainDate(),
				) < 0
			)
				return { ok: false, reason: "conflicting_history" };
		}
		const receivedQuantity = assignment.receivedQuantity + quantity;
		if (
			!exception &&
			receivedQuantity +
				assignment.lostQuantity +
				assignment.waivedQuantity -
				assignment.exceptionReceivedQuantity >
				assignment.quantity
		)
			return { ok: false, reason: "excess_quantity" };
		const [issue] = await tx
			.select()
			.from(equipmentHandover)
			.where(
				and(
					eq(equipmentHandover.organizationId, actor.organizationId),
					eq(equipmentHandover.assignmentId, assignment.id),
					eq(equipmentHandover.kind, "issue"),
				),
			);
		if (
			!issue ||
			(issue.actualDate !== null &&
				Temporal.PlainDate.compare(
					parsePlainDate(change.actualDate),
					parsePlainDate(issue.actualDate),
				) < 0)
		)
			return { ok: false, reason: "conflicting_history" };
		const [item] = assignment.itemId
			? await tx
					.select()
					.from(equipmentItem)
					.where(scoped(actor.organizationId, assignment.itemId))
			: [];
		if (assignment.itemId && !item?.inCustody)
			return { ok: false, reason: "item_unavailable" };
		await tx.insert(equipmentHandover).values({
			organizationId: actor.organizationId,
			assignmentId: assignment.id,
			kind: "receipt",
			exceptionId: exception?.id ?? null,
			quantity,
			actualDate: change.actualDate,
			condition: change.condition,
			notes: change.notes || null,
			actorId: actor.userId,
			recordedAt,
		});
		if (exception)
			await tx
				.update(equipmentException)
				.set({ receivedQuantity: exception.receivedQuantity + quantity })
				.where(
					and(
						eq(equipmentException.organizationId, actor.organizationId),
						eq(equipmentException.id, exception.id),
					),
				);
		const [updated] = await tx
			.update(equipmentAssignment)
			.set({
				received: receivedQuantity === assignment.quantity,
				receivedQuantity,
				exceptionReceivedQuantity:
					assignment.exceptionReceivedQuantity + (exception ? quantity : 0),
				revision: assignment.revision + 1,
			})
			.where(assignmentScope(actor.organizationId, assignment.id))
			.returning();
		if (item)
			await tx
				.update(equipmentItem)
				.set({
					inCustody: false,
					lastHandoverDate: change.actualDate,
					status:
						change.condition === "damaged" && item.status !== "retired"
							? "unavailable"
							: item.status,
					revision: item.revision + 1,
					updatedBy: actor.userId,
					updatedAt: recordedAt,
				})
				.where(scoped(actor.organizationId, item.id));
		result = updated;
	}
	const outcome = {
		ok: true,
		id: result.id,
		revision: result.revision,
	} as const;
	return outcome;
}

/** Preserve the original ending date even when equipment is first entered after exit. */
async function historicalEndingDeadline(
	tx: EquipmentTransaction,
	organizationId: string,
	employeeId: string,
	periodId: string | null,
	timezone: string,
	legacyDeactivatedAt: Date | null,
): Promise<string | null> {
	const periodScope = periodId
		? eq(equipmentAssignment.employmentPeriodId, periodId)
		: isNull(equipmentAssignment.employmentPeriodId);
	const [existing] = await tx
		.select({ deadline: equipmentAssignment.departureDeadline })
		.from(equipmentAssignment)
		.where(
			and(
				eq(equipmentAssignment.organizationId, organizationId),
				eq(equipmentAssignment.employeeId, employeeId),
				periodScope,
				isNotNull(equipmentAssignment.departureDeadline),
			),
		)
		.limit(1);
	if (existing?.deadline) return existing.deadline;
	const [deactivation] = await tx
		.select({
			at: employeeDeactivation.deactivatedAt,
			plan: employeeDeactivation.plan,
		})
		.from(employeeDeactivation)
		.where(
			and(
				eq(employeeDeactivation.organizationId, organizationId),
				eq(employeeDeactivation.employeeId, employeeId),
				periodId
					? eq(employeeDeactivation.employmentPeriodId, periodId)
					: isNull(employeeDeactivation.employmentPeriodId),
			),
		)
		.orderBy(desc(employeeDeactivation.deactivatedAt))
		.limit(1);
	const at = deactivation?.at ?? legacyDeactivatedAt;
	if (!at) return null;
	const frozenTimezone =
		typeof deactivation?.plan?.timeZone === "string"
			? resolveOrganizationTimezone(deactivation.plan.timeZone).timezone
			: timezone;
	return equipmentDepartureDeadline(
		instantFromDate(at),
		frozenTimezone,
		"immediate",
	);
}

/** Staff overview, scoped employee history and self history share one permission/read model. */
export async function readEquipment(
	db: typeof database,
	actor: EquipmentActor,
	scope:
		| { kind: "overview"; filters: EquipmentFilters }
		| { kind: "employee"; employeeId: string }
		| { kind: "personal" },
): Promise<EquipmentView> {
	return db.transaction(async (tx) => {
		await lockEquipmentContext(tx, actor);
		const access = await equipmentAccess(tx, actor);
		const employeeId =
			scope.kind === "personal"
				? access.employeeId
				: scope.kind === "employee"
					? scope.employeeId
					: undefined;
		const coversSubject = employeeId
			? access.canManage &&
				(await equipmentCoversEmployee(tx, actor, access, employeeId))
			: false;
		if (
			(scope.kind === "overview" && !access.canManage) ||
			(scope.kind === "employee" &&
				!access.canAdminister &&
				!coversSubject &&
				employeeId !== access.employeeId) ||
			(scope.kind === "overview" &&
				!access.canAdminister &&
				scope.filters.holderId &&
				!(await equipmentCoversEmployee(
					tx,
					actor,
					access,
					scope.filters.holderId,
				)))
		)
			throw new AuthorizationError({
				message: "You cannot read these equipment records.",
				resource: "equipment",
				action: "read",
			});
		const calendar = await organizationCalendar(tx, actor.organizationId);
		const { timezone, today, policyConfigured } = calendar;
		const staffView =
			scope.kind !== "personal" &&
			(scope.kind === "overview" ? access.canManage : coversSubject);
		const employees = await tx
			.select({
				id: employee.id,
				userId: employee.userId,
				firstName: employee.firstName,
				lastName: employee.lastName,
				name: user.name,
				current: employeeHasOrganizationAccess(calendar.now),
			})
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employee.organizationId, actor.organizationId),
					staffView
						? equipmentSubjectScope(access)
						: eq(
								employee.id,
								employeeId ?? "00000000-0000-0000-0000-000000000000",
							),
				),
			)
			.orderBy(asc(user.name), asc(employee.id));
		const employeeMap = new Map(
			employees.map((e) => [
				e.id,
				{
					id: e.id,
					userId: e.userId,
					name: [e.firstName, e.lastName].filter(Boolean).join(" ") || e.name,
					former: !e.current,
				},
			]),
		);
		const rows =
			employeeId === null
				? []
				: await tx
						.select({
							assignment: equipmentAssignment,
							item: equipmentItem,
							type: equipmentType,
						})
						.from(equipmentAssignment)
						.leftJoin(
							equipmentItem,
							and(
								eq(equipmentItem.id, equipmentAssignment.itemId),
								eq(
									equipmentItem.organizationId,
									equipmentAssignment.organizationId,
								),
							),
						)
						.innerJoin(
							equipmentType,
							and(
								eq(equipmentType.id, equipmentAssignment.typeId),
								eq(
									equipmentType.organizationId,
									equipmentAssignment.organizationId,
								),
							),
						)
						.where(
							and(
								eq(equipmentAssignment.organizationId, actor.organizationId),
								inArray(equipmentAssignment.employeeId, [
									...employeeMap.keys(),
								]),
								employeeId
									? eq(equipmentAssignment.employeeId, employeeId)
									: undefined,
							),
						)
						.orderBy(
							asc(equipmentItem.identifier),
							asc(equipmentAssignment.id),
						);
		const handovers = rows.length
			? await tx
					.select({ record: equipmentHandover, actorName: user.name })
					.from(equipmentHandover)
					.leftJoin(user, eq(user.id, equipmentHandover.actorId))
					.where(
						and(
							eq(equipmentHandover.organizationId, actor.organizationId),
							inArray(
								equipmentHandover.assignmentId,
								rows.map((r) => r.assignment.id),
							),
						),
					)
					.orderBy(
						asc(equipmentHandover.actualDate),
						asc(equipmentHandover.recordedAt),
						asc(equipmentHandover.id),
					)
			: [];
		const exceptionRows = rows.length
			? await tx
					.select({ record: equipmentException, actorName: user.name })
					.from(equipmentException)
					.leftJoin(user, eq(user.id, equipmentException.actorId))
					.where(
						and(
							eq(equipmentException.organizationId, actor.organizationId),
							inArray(
								equipmentException.assignmentId,
								rows.map((r) => r.assignment.id),
							),
						),
					)
					.orderBy(
						asc(equipmentException.recordedAt),
						asc(equipmentException.id),
					)
			: [];
		const exceptionEvidence = new Map<string, EquipmentExceptionView[]>();
		for (const { record, actorName } of exceptionRows) {
			const list = exceptionEvidence.get(record.assignmentId) ?? [];
			list.push({
				...record,
				receivedQuantity: record.receivedQuantity,
				actorName,
				recordedAt: instantFromDate(record.recordedAt).toString(),
				canReceive: false,
			});
			exceptionEvidence.set(record.assignmentId, list);
		}
		const evidence = new Map<string, EquipmentHandoverView[]>();
		for (const { record, actorName } of handovers) {
			const key = `${record.assignmentId}:${record.kind}`;
			const records = evidence.get(key) ?? [];
			records.push({
				id: record.id,
				exceptionId: record.exceptionId,
				quantity: record.quantity,
				actualDate: record.actualDate,
				historical: record.historical,
				condition: record.condition,
				notes: record.notes,
				actorId: record.actorId,
				actorName,
				recordedAt: instantFromDate(record.recordedAt).toString(),
			});
			evidence.set(key, records);
		}
		const filters = scope.kind === "overview" ? scope.filters : {};
		const assignments: EquipmentAssignmentView[] = [];
		for (const { assignment, item, type } of rows) {
			const holder = employeeMap.get(assignment.employeeId ?? "");
			const issue = evidence.get(`${assignment.id}:issue`)?.[0];
			const receipts = evidence.get(`${assignment.id}:receipt`) ?? [];
			if (!holder || !issue) continue;
			// Exception closure settles the obligation without pretending physical receipt.
			const outstandingQuantity = assignment.returnRequired
				? assignment.quantity -
					assignment.receivedQuantity -
					assignment.lostQuantity -
					assignment.waivedQuantity +
					assignment.exceptionReceivedQuantity
				: 0;
			const outstanding = outstandingQuantity > 0;
			const effectiveDeadline = effectiveEquipmentDeadline(
				assignment.explicitDeadline,
				assignment.departureDeadline,
			);
			const overdue =
				outstanding &&
				!!effectiveDeadline &&
				Temporal.PlainDate.compare(parsePlainDate(effectiveDeadline), today) <
					0;
			if (
				(filters.holderId && holder.id !== filters.holderId) ||
				(filters.typeId && type.id !== filters.typeId) ||
				(filters.outstanding !== undefined &&
					filters.outstanding !== outstanding) ||
				(filters.overdue !== undefined && filters.overdue !== overdue) ||
				(filters.former !== undefined && filters.former !== holder.former)
			)
				continue;
			assignments.push({
				lostQuantity: assignment.lostQuantity,
				waivedQuantity: assignment.waivedQuantity,
				recoveredQuantity: (exceptionEvidence.get(assignment.id) ?? [])
					.filter((e) => e.kind === "lost")
					.reduce((sum, e) => sum + e.receivedQuantity, 0),
				exceptions: (exceptionEvidence.get(assignment.id) ?? []).map((e) => ({
					...e,
					canReceive:
						staffView &&
						holder.userId !== actor.userId &&
						e.receivedQuantity < e.quantity,
				})),
				canCloseException:
					staffView &&
					access.canAdminister &&
					outstanding &&
					holder.userId !== actor.userId,
				id: assignment.id,
				itemId: item?.id ?? null,
				trackingMode: type.trackingMode,
				quantity: assignment.quantity,
				physicallyReceivedQuantity: assignment.receivedQuantity,
				outstandingQuantity,
				typeId: type.id,
				typeName: type.name,
				identifier: item?.identifier ?? type.name,
				employeeId: holder.id,
				holderName: holder.name,
				former: holder.former,
				returnRequired: assignment.returnRequired,
				explicitDeadline: assignment.explicitDeadline,
				departureDeadline: assignment.departureDeadline,
				effectiveDeadline,
				employmentPeriodId: assignment.employmentPeriodId,
				departureId: assignment.departureId,
				deactivationId: assignment.deactivationId,
				outstanding,
				overdue,
				held: !assignment.received,
				revision: assignment.revision,
				canReceive:
					staffView &&
					(!assignment.returnRequired ? !assignment.received : outstanding) &&
					holder.userId !== actor.userId,
				transfer:
					staffView &&
					policyConfigured &&
					(!assignment.returnRequired ? !assignment.received : outstanding) &&
					holder.userId !== actor.userId &&
					!type.archivedAt &&
					(!item ||
						(!item.archivedAt && item.inCustody && item.status === "available"))
						? {
								expectedIssuanceRevision: item?.revision ?? type.revision,
								defaultReturnRequired: type.defaultReturnRequired,
							}
						: undefined,
				issue,
				receipt: receipts.at(-1) ?? null,
				receipts,
			});
		}
		const types = staffView
			? await tx
					.select({ id: equipmentType.id, name: equipmentType.name })
					.from(equipmentType)
					.where(eq(equipmentType.organizationId, actor.organizationId))
					.orderBy(asc(equipmentType.name))
			: [];
		const availableItems =
			staffView && policyConfigured
				? await tx
						.select({
							id: equipmentItem.id,
							identifier: equipmentItem.identifier,
							typeId: equipmentType.id,
							typeName: equipmentType.name,
							defaultReturnRequired: equipmentType.defaultReturnRequired,
							revision: equipmentItem.revision,
						})
						.from(equipmentItem)
						.innerJoin(
							equipmentType,
							and(
								eq(equipmentType.id, equipmentItem.typeId),
								eq(equipmentType.organizationId, equipmentItem.organizationId),
							),
						)
						.where(
							and(
								eq(equipmentItem.organizationId, actor.organizationId),
								eq(equipmentItem.inCustody, false),
								eq(equipmentItem.status, "available"),
								sql`${equipmentItem.archivedAt} is null`,
								sql`${equipmentType.archivedAt} is null`,
								eq(equipmentType.trackingMode, "individual"),
							),
						)
						.orderBy(asc(equipmentItem.identifier))
				: [];
		const availableQuantityTypes =
			staffView && policyConfigured
				? await tx
						.select({
							id: equipmentType.id,
							name: equipmentType.name,
							defaultReturnRequired: equipmentType.defaultReturnRequired,
							revision: equipmentType.revision,
						})
						.from(equipmentType)
						.where(
							and(
								eq(equipmentType.organizationId, actor.organizationId),
								eq(equipmentType.trackingMode, "quantity"),
								sql`${equipmentType.archivedAt} is null`,
							),
						)
						.orderBy(asc(equipmentType.name), asc(equipmentType.id))
				: [];
		const employmentPeriods =
			staffView && employeeMap.size
				? await tx
						.select()
						.from(employeeEmploymentPeriod)
						.where(
							and(
								eq(
									employeeEmploymentPeriod.organizationId,
									actor.organizationId,
								),
								inArray(employeeEmploymentPeriod.employeeId, [
									...employeeMap.keys(),
								]),
							),
						)
				: [];
		return {
			employmentPeriods: employmentPeriods.map((period) => ({
				id: period.id,
				employeeId: period.employeeId,
				startedOn: period.startedAt
					? instantFromDate(period.startedAt)
							.toZonedDateTimeISO(timezone)
							.toPlainDate()
							.toString()
					: null,
				endedOn: period.endedAt
					? instantFromDate(period.endedAt)
							.toZonedDateTimeISO(timezone)
							.toPlainDate()
							.toString()
					: null,
			})),
			readinessItems: staffView
				? await readItemReadiness(
						tx,
						actor.organizationId,
						equipmentItemScope(access),
					)
				: [],
			availableQuantityTypes,
			canManage: staffView,
			canAdminister: access.canAdminister && scope.kind !== "personal",
			registrationTypes:
				staffView && policyConfigured
					? await tx
							.select({
								id: equipmentType.id,
								name: equipmentType.name,
								defaultReturnRequired: equipmentType.defaultReturnRequired,
							})
							.from(equipmentType)
							.where(
								and(
									eq(equipmentType.organizationId, actor.organizationId),
									eq(equipmentType.trackingMode, "individual"),
									sql`${equipmentType.archivedAt} is null`,
								),
							)
							.orderBy(asc(equipmentType.name))
					: [],
			policyConfigured,
			timezone,
			today: today.toString(),
			assignments,
			availableItems,
			employees: staffView
				? [...employeeMap.values()].map(({ id, name, former }) => ({
						id,
						name,
						former,
					}))
				: [],
			types,
		};
	});
}
