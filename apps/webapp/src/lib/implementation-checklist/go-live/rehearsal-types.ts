import type { WeekdayName } from "@/lib/absences/working-days";
import type { ApproverGoLiveKind } from "./approver-routing";
import type { PayrollPrerequisites } from "./payroll-prerequisites";
import {
	type GoLiveFixLink,
	type GoLiveMember,
	type GoLiveMessage,
	goLiveMemberKey,
} from "./types";

/**
 * The go-live rehearsal (#1517, Organization ADR 0007): what Z8 would do for one checked member
 * of the go-live group, worked out with the go-live checks' own resolution and never written.
 * Plain data, so it crosses from a server action to the client as is.
 */

/** Why a rehearsal was refused: the member isn't in the go-live group being checked. */
export type GoLiveRehearsalRefusal = "member_not_checked";

/** A member who can be picked for a rehearsal: everyone the go-live checks ran over. */
export interface GoLiveRehearsalCandidate {
	/** `goLiveMemberKey` of the member. */
	key: string;
	displayName: string;
	invited: boolean;
}

export function goLiveRehearsalCandidates(
	members: readonly GoLiveMember[],
): GoLiveRehearsalCandidate[] {
	return members.map((member) => ({
		key: goLiveMemberKey(member),
		displayName: member.displayName,
		invited: member.kind === "invitee",
	}));
}

export interface GoLiveRehearsalPerson {
	employeeId: string;
	displayName: string;
}

export type GoLiveRehearsalWorkPolicy =
	| {
			status: "resolved";
			policyId: string;
			policyName: string;
			/** The level the policy is assigned at: the member, their primary team, or the organization. */
			assignmentType: "organization" | "team" | "employee";
			/** The work policy service's own label for that level ("Individual", the team's name, …). */
			assignedVia: string;
			/** Null when the policy's scheduling is off. */
			schedule: {
				cycle: string;
				/** Hours per cycle; null when the schedule names none. */
				hours: number | null;
				workingDays: WeekdayName[];
			} | null;
	  }
	| { status: "none"; fix: GoLiveFixLink | null };

export interface GoLiveRehearsalStage {
	sequence: number;
	label: string | null;
	approverType: string;
	fallbackBehavior: string | null;
	/** Whether the stage starts with the request, or once the stages before it decide. */
	activates: "at_submission" | "after_earlier_stages";
	/** Who decides: people, the requester themselves (it completes), or nobody would be found. */
	resolution: "human" | "requester_auto_approve" | "unresolvable";
	approvers: GoLiveRehearsalPerson[];
	/** The approvers come from the stage's fallback, not its own rule. */
	viaFallback: boolean;
	/** The approver the stage names, who has left; whoever decides stands in for them. */
	standsInFor: GoLiveRehearsalPerson | null;
}

export interface GoLiveRehearsalRoute {
	path: "canonical" | "legacy" | "shift_deciders";
	/** The matched approval policy's name; null when the default approver decides. */
	policyName: string | null;
	stages: GoLiveRehearsalStage[];
}

/** One way a request of the kind can go (an absence category, an expense total band). */
export interface GoLiveRehearsalVariant {
	/** What this way was traced with; null when the kind has only one way through. */
	label: GoLiveMessage | null;
	status: "routed" | "skipped" | "unroutable";
	route: GoLiveRehearsalRoute | null;
	/** Why no approval is needed, or why it can't be routed. */
	reason: GoLiveMessage | null;
}

export interface GoLiveRehearsalKind {
	kind: ApproverGoLiveKind;
	label: GoLiveMessage;
	/** The same status the approver go-live check gives this member for the kind. */
	status: "routed" | "skipped" | "unroutable";
	/** Why no approval is needed, or why it can't be routed. */
	reason: GoLiveMessage | null;
	/** Where an unroutable kind is fixed, when the viewer may open it. */
	fix: GoLiveFixLink | null;
	variants: GoLiveRehearsalVariant[];
}

export interface GoLiveRehearsal {
	member: GoLiveMember;
	/** When it was worked out: an ISO instant, the organization's timezone and its today. */
	asOf: { instant: string; timezone: string; today: string };
	workPolicy: GoLiveRehearsalWorkPolicy;
	approvals: {
		kinds: GoLiveRehearsalKind[];
		/** Kinds switched off for the organization, so not traced. */
		offKinds: ApproverGoLiveKind[];
	};
	/** Only when the organization exports payroll (has an active payroll export target). */
	payroll: {
		prerequisites: PayrollPrerequisites;
		payrollExportFix: GoLiveFixLink | null;
		employeesFix: GoLiveFixLink | null;
	} | null;
}

export type GoLiveRehearsalResult =
	| { ok: true; rehearsal: GoLiveRehearsal }
	| { ok: false; refusal: GoLiveRehearsalRefusal };

/** What the rehearsal server action answers. `unavailable`: a lookup failed; try again. */
export type GoLiveRehearsalActionResult =
	| { success: true; data: GoLiveRehearsal }
	| { success: false; error: GoLiveRehearsalRefusal | "unavailable" };
