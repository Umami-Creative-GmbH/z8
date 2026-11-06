import { z } from "zod";
import { parsePlainDate } from "@/lib/datetime/temporal-core";

export type EquipmentDepartureReturn = {
	assignmentId: string;
	identifier: string;
	typeName: string;
	outstandingQuantity: number;
	explicitDeadline: string | null;
	effectiveDeadline: string | null;
};

const request = { requestId: z.uuid() };
const revision = { expectedRevision: z.number().int().nonnegative() };
const typeFields = {
	name: z.string().trim().min(1).max(100),
	trackingMode: z.enum(["individual", "quantity"]),
	defaultReturnRequired: z.boolean(),
};
export const equipmentSetupChangeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("configure_policy"),
		...request,
		...revision,
		retentionMonths: z.number().int().positive().max(2147483647),
	}),
	z.strictObject({ kind: z.literal("create_type"), ...request, ...typeFields }),
	z.strictObject({
		kind: z.literal("update_type"),
		...request,
		...revision,
		id: z.uuid(),
		...typeFields,
	}),
	z.strictObject({
		kind: z.literal("archive_type"),
		...request,
		...revision,
		id: z.uuid(),
	}),
	z.strictObject({
		kind: z.literal("register_item"),
		...request,
		typeId: z.uuid(),
		identifier: z.string().trim().min(1).max(100),
		serialNumber: z.string().trim().max(200).optional(),
	}),
	z.strictObject({
		kind: z.literal("archive_item"),
		...request,
		...revision,
		id: z.uuid(),
	}),
]);
export type EquipmentSetupChange = z.infer<typeof equipmentSetupChangeSchema>;
export const equipmentSetupDetailSchema = z.strictObject({
	kind: z.enum(["type", "item"]),
	id: z.uuid(),
});
export type EquipmentSetupDetailInput = z.infer<
	typeof equipmentSetupDetailSchema
>;
export type EquipmentSetupDetail =
	| { kind: "type"; record: EquipmentTypeView }
	| { kind: "item"; record: EquipmentItemView };
export type EquipmentSetupRefusal =
	| "invalid_input"
	| "not_found"
	| "policy_required"
	| "archived"
	| "tracking_mode_fixed"
	| "individual_required"
	| "identifier_taken"
	| "stale_revision"
	| "request_conflict";
export type EquipmentSetupOutcome =
	| { ok: true; id: string; revision: number }
	| { ok: false; reason: EquipmentSetupRefusal };
export interface EquipmentTypeView {
	id: string;
	name: string;
	trackingMode: "individual" | "quantity";
	defaultReturnRequired: boolean;
	used: boolean;
	archived: boolean;
	revision: number;
}
export interface EquipmentItemView {
	id: string;
	typeId: string;
	identifier: string;
	serialNumber: string | null;
	status: "available" | "unavailable" | "retired";
	inCustody: boolean;
	archived: boolean;
	revision: number;
}
export interface EquipmentSetupView {
	policy: { retentionMonths: number; revision: number } | null;
	types: EquipmentTypeView[];
	/** Only these types can be selected for registration or future issuance. */
	selectableTypes: EquipmentTypeView[];
	items: EquipmentItemView[];
}

const calendarDate = z.string().refine((value) => {
	try {
		parsePlainDate(value);
		return true;
	} catch {
		return false;
	}
}, "Enter a valid calendar date.");
export const equipmentConditionSchema = z.enum([
	"good",
	"worn",
	"damaged",
	"unknown",
]);
export type EquipmentCondition = z.infer<typeof equipmentConditionSchema>;
const handoverFields = {
	...request,
	...revision,
	actualDate: calendarDate,
	condition: equipmentConditionSchema,
	notes: z.string().trim().max(4000).optional(),
};
const historicalFields = {
	...handoverFields,
	/** Explicit null means the actual historical issue date is unknown. */
	actualDate: calendarDate.nullable(),
	employmentPeriodId: z.uuid().optional(),
	endingContext: z.union([z.uuid(), z.literal("current")]).optional(),
	employeeId: z.uuid(),
	returnRequired: z.boolean(),
	explicitDeadline: calendarDate.nullable().optional(),
};
const transferEvidence = {
	actualDate: calendarDate,
	condition: equipmentConditionSchema,
	notes: z.string().trim().max(4000).optional(),
};
export const equipmentQuantitySchema = z
	.number()
	.int()
	.positive()
	.max(2147483647);
export const equipmentChangeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("propose_custody_receipt"),
		...request,
		...revision,
		itemId: z.uuid(),
		actualDate: calendarDate,
		condition: equipmentConditionSchema,
	}),
	z.strictObject({
		kind: z.literal("confirm_custody_receipt"),
		...request,
		...revision,
		itemId: z.uuid(),
		proposalId: z.uuid(),
	}),
	z.strictObject({
		kind: z.literal("place_case_hold"),
		...request,
		...revision,
		assignmentId: z.uuid(),
		reason: z.string().trim().min(1).max(4000),
	}),
	z.strictObject({
		kind: z.literal("release_case_hold"),
		...request,
		...revision,
		assignmentId: z.uuid(),
		reason: z.string().trim().min(1).max(4000),
	}),
	z.strictObject({
		kind: z.literal("correct_transfer"),
		...request,
		...revision,
		assignmentId: z.uuid(),
		destinationAssignmentId: z.uuid(),
		expectedDestinationRevision: z.number().int().positive(),
		quantity: equipmentQuantitySchema,
		receipt: z.strictObject(transferEvidence),
		issue: z.strictObject(transferEvidence),
		reason: z.string().trim().min(1).max(4000),
	}),
	z.strictObject({
		kind: z.literal("correct_issue"),
		...request,
		...revision,
		assignmentId: z.uuid(),
		reason: z.string().trim().min(1).max(4000),
		quantity: equipmentQuantitySchema,
		actualDate: calendarDate.nullable(),
		condition: equipmentConditionSchema,
		notes: z.string().trim().max(4000),
		returnRequired: z.boolean(),
		explicitDeadline: calendarDate.nullable(),
		employmentPeriodId: z.uuid().nullable(),
	}),
	z.strictObject({
		kind: z.literal("correct_receipt"),
		...request,
		...revision,
		assignmentId: z.uuid(),
		handoverId: z.uuid(),
		reason: z.string().trim().min(1).max(4000),
		quantity: z.number().int().nonnegative().max(2147483647),
		...transferEvidence,
	}),
	z.strictObject({
		kind: z.literal("correct_exception"),
		...request,
		...revision,
		assignmentId: z.uuid(),
		exceptionId: z.uuid(),
		reason: z.string().trim().min(1).max(4000),
		quantity: z.number().int().nonnegative().max(2147483647),
		outcome: z.enum(["lost", "waived"]),
		decisionReason: z.string().trim().min(1).max(4000),
	}),
	z.strictObject({
		kind: z.literal("record_historical_individual"),
		...historicalFields,
		itemId: z.uuid(),
	}),
	z.strictObject({
		kind: z.literal("record_historical_quantity"),
		...historicalFields,
		typeId: z.uuid(),
		quantity: equipmentQuantitySchema,
	}),
	z.strictObject({
		kind: z.literal("register_historical_individual"),
		...historicalFields,
		expectedRevision: z.literal(0),
		typeId: z.uuid(),
		identifier: z.string().trim().min(1).max(100),
		serialNumber: z.string().trim().max(200).optional(),
	}),
	z.strictObject({
		kind: z.literal("receive_exception"),
		...handoverFields,
		assignmentId: z.uuid(),
		exceptionId: z.uuid(),
		quantity: equipmentQuantitySchema,
	}),
	z.strictObject({
		kind: z.literal("close_return"),
		...request,
		...revision,
		assignmentId: z.uuid(),
		outcome: z.enum(["lost", "waived"]),
		quantity: equipmentQuantitySchema,
		reason: z.string().trim().min(1).max(4000),
	}),
	z.strictObject({
		kind: z.literal("transfer_equipment"),
		...request,
		...revision,
		assignmentId: z.uuid(),
		employeeId: z.uuid(),
		quantity: equipmentQuantitySchema,
		expectedIssuanceRevision: z.number().int().positive(),
		receipt: z.strictObject(transferEvidence),
		issue: z.strictObject({
			...transferEvidence,
			returnRequired: z.boolean(),
			explicitDeadline: calendarDate.nullable().optional(),
		}),
	}),
	z.strictObject({
		kind: z.literal("register_and_issue_individual"),
		...handoverFields,
		expectedRevision: z.literal(0),
		typeId: z.uuid(),
		identifier: z.string().trim().min(1).max(100),
		serialNumber: z.string().trim().max(200).optional(),
		employeeId: z.uuid(),
		returnRequired: z.boolean(),
		explicitDeadline: calendarDate.nullable().optional(),
	}),
	z.strictObject({
		kind: z.literal("clear_item"),
		...request,
		...revision,
		itemId: z.uuid(),
	}),
	z.strictObject({
		kind: z.literal("mark_item_unavailable"),
		...request,
		...revision,
		itemId: z.uuid(),
	}),
	z.strictObject({
		kind: z.literal("retire_item"),
		...request,
		...revision,
		itemId: z.uuid(),
	}),
	z.strictObject({
		kind: z.literal("issue_quantity"),
		...handoverFields,
		typeId: z.uuid(),
		employeeId: z.uuid(),
		quantity: equipmentQuantitySchema,
		returnRequired: z.boolean(),
		explicitDeadline: calendarDate.nullable().optional(),
	}),
	z.strictObject({
		kind: z.literal("receive_quantity"),
		...handoverFields,
		assignmentId: z.uuid(),
		quantity: equipmentQuantitySchema,
	}),
	z.strictObject({
		kind: z.literal("issue_individual"),
		...handoverFields,
		itemId: z.uuid(),
		employeeId: z.uuid(),
		returnRequired: z.boolean(),
		explicitDeadline: calendarDate.nullable().optional(),
	}),
	z.strictObject({
		kind: z.literal("receive_individual"),
		...handoverFields,
		assignmentId: z.uuid(),
	}),
]);
export type EquipmentChange = z.infer<typeof equipmentChangeSchema>;
export type EquipmentRefusal =
	| EquipmentSetupRefusal
	| "hold_unchanged"
	| "history_removed"
	| "transfer_conflict"
	| "recovery_conflict"
	| "readiness_conflict"
	| "forbidden"
	| "employee_not_current"
	| "item_unavailable"
	| "item_in_custody"
	| "item_retired"
	| "readiness_unchanged"
	| "self_receipt"
	| "self_exception"
	| "return_not_required"
	| "waiver_required"
	| "already_received"
	| "quantity_required"
	| "excess_quantity"
	| "future_date"
	| "conflicting_history";
export type EquipmentOutcome =
	| { ok: true; id: string; revision: number }
	| { ok: false; reason: EquipmentRefusal };
export const equipmentFiltersSchema = z.strictObject({
	holderId: z.uuid().optional(),
	typeId: z.uuid().optional(),
	outstanding: z.boolean().optional(),
	overdue: z.boolean().optional(),
	former: z.boolean().optional(),
});
export type EquipmentFilters = z.infer<typeof equipmentFiltersSchema>;
export interface EquipmentHandoverView {
	exceptionId: string | null;
	id: string;
	quantity: number;
	actualDate: string | null;
	historical?: boolean;
	condition: EquipmentCondition;
	notes: string | null;
	actorId: string | null;
	actorName: string | null;
	recordedAt: string;
}
export interface EquipmentExceptionView {
	id: string;
	kind: "lost" | "waived";
	quantity: number;
	receivedQuantity: number;
	reason: string;
	actorId: string | null;
	actorName: string | null;
	recordedAt: string;
	canReceive: boolean;
}
export interface EquipmentAssignmentView {
	retention?: EquipmentRetentionView;
	caseHolds?: {
		id: string;
		kind: "place" | "release";
		reason: string;
		actorName: string | null;
		recordedAt: string;
	}[];
	correctionTransfers?: {
		destinationAssignmentId: string;
		expectedDestinationRevision: number;
		receiptId: string;
		issue: EquipmentHandoverView;
	}[];
	canCorrect?: boolean;
	canCorrectReceipt?: boolean;
	canCorrectException?: boolean;
	corrections?: EquipmentCorrectionView[];
	lostQuantity: number;
	waivedQuantity: number;
	recoveredQuantity: number;
	exceptions: EquipmentExceptionView[];
	canCloseException: boolean;
	id: string;
	itemId: string | null;
	trackingMode: "individual" | "quantity";
	quantity: number;
	physicallyReceivedQuantity: number;
	outstandingQuantity: number;
	typeId: string;
	typeName: string;
	identifier: string;
	employeeId: string;
	holderName: string;
	/** The holder's own user image, read in the same organization-scoped row as the name. */
	holderImage: string | null;
	/** Manufacturer serial number of an individually identified item. */
	serialNumber: string | null;
	/**
	 * Staff views only: transfers this assignment took part in. `in` marks an issue
	 * that a transfer created, `out` a receipt that started one. The counterpart name
	 * is present only while that holder is in the reader's scope.
	 */
	transfers?: {
		direction: "in" | "out";
		handoverId: string;
		counterpartName: string | null;
	}[];
	former: boolean;
	returnRequired: boolean;
	explicitDeadline: string | null;
	departureDeadline: string | null;
	effectiveDeadline: string | null;
	employmentPeriodId: string | null;
	departureId: string | null;
	deactivationId: string | null;
	outstanding: boolean;
	overdue: boolean;
	held: boolean;
	revision: number;
	canReceive: boolean;
	/** Present only when the current actor can receive and the equipment is issuable after receipt. */
	transfer?: {
		expectedIssuanceRevision: number;
		defaultReturnRequired: boolean;
	};
	issue: EquipmentHandoverView;
	/** Latest physical receipt, retained for individual consumers. */
	receipt: EquipmentHandoverView | null;
	receipts: EquipmentHandoverView[];
}
export interface EquipmentRetentionView {
	lastActivityAt: string;
	expiresAt: string | null;
	caseHeld: boolean;
	status: "outstanding" | "case_hold" | "policy_required" | "due" | "retained";
}
export interface EquipmentCorrectionView {
	id: string;
	handoverId: string | null;
	exceptionId: string | null;
	expectedRevision: number;
	reason: string;
	before: Record<string, string | number | boolean | null>;
	after: Record<string, string | number | boolean | null>;
	actorId: string | null;
	actorName: string | null;
	recordedAt: string;
}
export interface EquipmentReadinessEventView {
	id: string;
	kind: "clearance" | "unavailable" | "retired";
	actorId: string | null;
	actorName: string | null;
	recordedAt: string;
}
export interface EquipmentReadinessItemView extends EquipmentItemView {
	personalHistoryCleaned?: boolean;
	canProposeCustodyReceipt?: boolean;
	custodyReceipt?: {
		id: string;
		actualDate: string;
		condition: EquipmentCondition;
		proposedBy: string | null;
		proposedByName?: string | null;
		confirmedByName?: string | null;
		proposedAt: string;
		confirmedBy: string | null;
		confirmedAt: string | null;
		canConfirm: boolean;
	};
	typeName: string;
	canClear: boolean;
	canMarkUnavailable: boolean;
	canRetire: boolean;
	history: EquipmentReadinessEventView[];
}
export interface EquipmentView {
	historicalContexts?: {
		id: string;
		employeeId: string;
		employmentPeriodId: string | null;
		startedOn: string | null;
		endedOn: string | null;
	}[];
	employmentPeriods?: {
		id: string;
		employeeId: string;
		startedOn: string | null;
		endedOn: string | null;
	}[];
	readinessItems: EquipmentReadinessItemView[];
	canManage: boolean;
	canAdminister: boolean;
	registrationTypes: {
		id: string;
		name: string;
		defaultReturnRequired: boolean;
	}[];
	policyConfigured: boolean;
	timezone: string;
	today: string;
	assignments: EquipmentAssignmentView[];
	availableQuantityTypes: {
		id: string;
		name: string;
		defaultReturnRequired: boolean;
		revision: number;
	}[];
	availableItems: {
		id: string;
		identifier: string;
		typeId: string;
		typeName: string;
		defaultReturnRequired: boolean;
		revision: number;
	}[];
	employees: {
		id: string;
		name: string;
		image: string | null;
		former: boolean;
		canIssue?: boolean;
	}[];
	types: { id: string; name: string }[];
}

export const equipmentOfficerChangeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("set_officer_grant"),
		...request,
		...revision,
		employeeId: z.uuid(),
		scope: z.enum(["all", "selected"]),
		teamIds: z.array(z.uuid()).max(500),
		employeeIds: z.array(z.uuid()).max(1000),
	}),
	z.strictObject({
		kind: z.literal("revoke_officer_grant"),
		...request,
		...revision,
		employeeId: z.uuid(),
	}),
]);
export type EquipmentOfficerChange = z.infer<
	typeof equipmentOfficerChangeSchema
>;
export interface EquipmentOfficerView {
	grants: {
		employeeId: string;
		name: string;
		scope: "all" | "selected";
		teamIds: string[];
		employeeIds: string[];
		revoked: boolean;
		current: boolean;
		revision: number;
	}[];
	employees: { id: string; name: string; current: boolean }[];
	teams: { id: string; name: string }[];
}
