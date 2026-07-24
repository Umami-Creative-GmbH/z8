import type { db } from "@/db";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	type PolicyClockOutBreakSnapshot,
	parsePolicyClockOutBreakSnapshot,
} from "@/lib/time-tracking/policy-clock-out-break-snapshot";
import type { ApprovalDbService } from "../workflow/ports";

export const ORDINARY_WORK_PERIOD_APPROVAL_KINDS = [
	"manual_time_submission",
	"policy_clock_out",
] as const;

export type OrdinaryWorkPeriodApprovalKind =
	(typeof ORDINARY_WORK_PERIOD_APPROVAL_KINDS)[number];

export interface OrdinaryWorkPeriodWorkflowPayload {
	timeRequest: { kind: OrdinaryWorkPeriodApprovalKind };
	breakPolicySnapshot?: PolicyClockOutBreakSnapshot;
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
	maintenance: WorkPeriodMaintenanceFacts | null;
}

export interface WorkPeriodMaintenanceFacts {
	organizationId: string;
	employeeId: string;
	dirtyFromDate: string;
	decision: "approved" | "rejected";
	surchargePeriodIds: string[];
	staleSurchargePeriodIds: string[];
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

function readExactDataProperties(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new Error("Ordinary work-period workflow payload is invalid");
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const ownKeys = Reflect.ownKeys(descriptors);
	if (
		ownKeys.length !== keys.length ||
		ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
	) {
		throw new Error("Ordinary work-period workflow payload is invalid");
	}
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const descriptor = descriptors[key];
		if (!descriptor?.enumerable || !("value" in descriptor)) {
			throw new Error("Ordinary work-period workflow payload is invalid");
		}
		result[key] = descriptor.value;
	}
	return result;
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
		if (
			typeof value !== "object" ||
			value === null ||
			Array.isArray(value) ||
			Object.getPrototypeOf(value) !== Object.prototype
		) {
			throw new Error("Ordinary work-period workflow payload is invalid");
		}
		const timeRequestDescriptor = Object.getOwnPropertyDescriptor(
			value,
			"timeRequest",
		);
		if (
			!timeRequestDescriptor?.enumerable ||
			!("value" in timeRequestDescriptor)
		) {
			throw new Error("Ordinary work-period workflow payload is invalid");
		}
		const kind = readExactDataProperty(timeRequestDescriptor.value, "kind");
		if (
			!isOrdinaryWorkPeriodApprovalKind(kind) ||
			kind !== (expectedKind ?? kind)
		) {
			throw new Error("Ordinary work-period workflow payload is invalid");
		}
		const hasSnapshot = kind === "policy_clock_out";
		const root = readExactDataProperties(
			value,
			hasSnapshot ? ["timeRequest", "breakPolicySnapshot"] : ["timeRequest"],
		);
		const normalizedRequest = Object.freeze({ kind });
		if (!hasSnapshot) {
			return Object.freeze({ timeRequest: normalizedRequest });
		}
		const snapshotInput = root.breakPolicySnapshot;
		const evaluatedAtDescriptor =
			typeof snapshotInput === "object" && snapshotInput !== null
				? Object.getOwnPropertyDescriptor(snapshotInput, "evaluatedAt")
				: undefined;
		if (
			!evaluatedAtDescriptor?.enumerable ||
			!("value" in evaluatedAtDescriptor) ||
			typeof evaluatedAtDescriptor.value !== "string"
		) {
			throw new Error("Ordinary work-period workflow payload is invalid");
		}
		return Object.freeze({
			timeRequest: normalizedRequest,
			breakPolicySnapshot: parsePolicyClockOutBreakSnapshot(
				snapshotInput,
				evaluatedAtDescriptor.value,
			),
		});
	} catch {
		throw new Error("Ordinary work-period workflow payload is invalid");
	}
}
