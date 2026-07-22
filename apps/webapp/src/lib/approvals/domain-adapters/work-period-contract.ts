import type { db } from "@/db";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { ApprovalDbService } from "../workflow/ports";

export const ORDINARY_WORK_PERIOD_APPROVAL_KINDS = [
	"manual_time_submission",
	"policy_clock_out",
] as const;

export type OrdinaryWorkPeriodApprovalKind =
	(typeof ORDINARY_WORK_PERIOD_APPROVAL_KINDS)[number];

export interface OrdinaryWorkPeriodWorkflowPayload {
	timeRequest: { kind: OrdinaryWorkPeriodApprovalKind };
}

export interface OrdinaryWorkPeriodApprovalSource {
	id: string;
	organizationId: string;
	employeeId: string;
	canonicalRecordId: string;
	approvalWorkflowId: string | null;
	approvalStatus: "pending" | "approved" | "rejected";
	startTime: string;
	endTime: string;
	durationMinutes: number;
	payload: Readonly<OrdinaryWorkPeriodWorkflowPayload>;
}

export interface WorkPeriodApprovalResult {
	kind: OrdinaryWorkPeriodApprovalKind;
	action: "approve" | "reject";
	reason: string | null;
	period: {
		id: string;
		organizationId: string;
		employeeId: string;
		canonicalRecordId: string;
		startTime: Date;
		endTime: Date;
	};
}

export type OrdinaryWorkPeriodFinalizerDatabase =
	| typeof db
	| Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OrdinaryWorkPeriodFinalizerDbService {
	db: OrdinaryWorkPeriodFinalizerDatabase;
}

export type OrdinaryWorkPeriodTerminalEvidence =
	| {
			mode: "legacy";
			approvalRequestId: string;
			requestMode: "manager" | "requester_auto_completed";
			expectedStatus: "approved" | "rejected";
	  }
	| {
			mode: "canonical";
			workflowId: string;
			payload: Readonly<OrdinaryWorkPeriodWorkflowPayload>;
	  };

interface FinalizeOrdinaryWorkPeriodTerminalFields {
	organizationId: string;
	workPeriodId: string;
	expectedApprovalWorkflowId: string | null;
	requesterEmployeeId: string;
	actorEmployeeId: string;
	actorUserId: string;
	kind: OrdinaryWorkPeriodApprovalKind;
	evidence: OrdinaryWorkPeriodTerminalEvidence;
	transition:
		| { kind: "approve"; reason: string | null }
		| { kind: "reject"; reason: string };
	finalizedAt: Instant;
}

export interface FinalizeOrdinaryWorkPeriodTerminalInput
	extends FinalizeOrdinaryWorkPeriodTerminalFields {
	dbService: OrdinaryWorkPeriodFinalizerDbService;
}

export interface FinalizeOrdinaryWorkPeriodTerminalAdapterInput
	extends FinalizeOrdinaryWorkPeriodTerminalFields {
	dbService: ApprovalDbService;
}

function readExactDataProperty(value: unknown, key: string): unknown {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new Error("Ordinary work-period workflow payload is invalid");
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	const descriptor = descriptors[key];
	if (
		keys.length !== 1 ||
		keys[0] !== key ||
		!descriptor?.enumerable ||
		!("value" in descriptor)
	) {
		throw new Error("Ordinary work-period workflow payload is invalid");
	}
	return descriptor.value;
}

function isOrdinaryWorkPeriodApprovalKind(
	value: unknown,
): value is OrdinaryWorkPeriodApprovalKind {
	return value === "manual_time_submission" || value === "policy_clock_out";
}

export function parseOrdinaryWorkPeriodWorkflowPayload(
	value: unknown,
	expectedKind?: OrdinaryWorkPeriodApprovalKind,
): Readonly<OrdinaryWorkPeriodWorkflowPayload> {
	try {
		const timeRequest = readExactDataProperty(value, "timeRequest");
		const kind = readExactDataProperty(timeRequest, "kind");
		if (
			!isOrdinaryWorkPeriodApprovalKind(kind) ||
			kind !== (expectedKind ?? kind)
		) {
			throw new Error("Ordinary work-period workflow payload is invalid");
		}
		return Object.freeze({ timeRequest: Object.freeze({ kind }) });
	} catch {
		throw new Error("Ordinary work-period workflow payload is invalid");
	}
}
