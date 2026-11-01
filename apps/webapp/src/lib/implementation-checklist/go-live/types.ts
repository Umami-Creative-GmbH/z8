import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import type { ImplementationChecklistItemId } from "../definition";

/**
 * Go-live readiness vocabulary (Organization glossary, "Going live"; ADR 0007).
 * Everything here is computed live on each view and never stored.
 */

/** An item's status on the implementation checklist. */
export type ImplementationChecklistItemStatus =
	/** Nothing is configured yet. */
	| "not-set-up"
	/** Settings exist, but no go-live check has verified them. */
	| "configured"
	/** The item's go-live check passed for every member of the go-live group. */
	| "verified"
	/** The item's go-live check failed for at least one member. */
	| "needs-attention"
	/** A lookup failed. Never a pass; the viewer can retry. */
	| "unavailable";

/** Overall go-live readiness, from mandatory go-live checks only. */
export type GoLiveReadinessStatus = "ready" | "not-ready" | "unavailable";

/**
 * How an item counts. Mandatory and advisory items carry a go-live check;
 * informational and manual-only items count toward checklist progress only.
 */
export type ImplementationChecklistItemRole =
	| "mandatory"
	| "advisory"
	| "informational"
	| "manual-only";

/** Whether a go-live check's failures block readiness or are shown as warnings. */
export type GoLiveCheckSeverity = "mandatory" | "advisory";

/** The moment go-live checks are worked out for, with the organization's "today". */
export interface GoLiveAsOf {
	instant: Instant;
	/** The organization's IANA timezone. */
	timezone: string;
	/** Today in the organization's timezone. */
	today: PlainDate;
}

/** A member of the go-live group: an employee on the current roster, or a pending invitee. */
export type GoLiveMember =
	| {
			kind: "employee";
			employeeId: string;
			primaryTeamId: string | null;
			displayName: string;
	  }
	| {
			kind: "invitee";
			draftId: string;
			email: string;
			teamId: string | null;
			displayName: string;
	  };

/** The people go-live checks run over. Every check takes this; none builds its own. */
export interface GoLiveGroup {
	members: GoLiveMember[];
	/** Names of the organization's teams that members belong to, by team id. */
	teamNames: ReadonlyMap<string, string>;
}

/** Translatable text: a Tolgee key, its English default and ICU params. */
export interface GoLiveMessage {
	key: string;
	fallback: string;
	params?: Record<string, string | number>;
}

/** A settings page that resolves a failure, offered only when the viewer may open it. */
export interface GoLiveFixLink {
	href: string;
	label: GoLiveMessage;
}

/** Builds a fix link, or null when the viewer may not open `href`. */
export type GoLiveFixLinkResolver = (href: string, label: GoLiveMessage) => GoLiveFixLink | null;

export interface GoLiveAffectedMember {
	member: GoLiveMember;
	/** Why this member fails, when the group has no shared cause. */
	detail?: GoLiveMessage;
}

/**
 * Members failing a check for one cause ("Team X has no work policy"). A null
 * `cause` lists members one by one, each with its own `detail`.
 */
export interface GoLiveFailureGroup {
	cause: string | null;
	reason: GoLiveMessage;
	members: GoLiveAffectedMember[];
	fix: GoLiveFixLink | null;
}

/** What one go-live check found. */
export type GoLiveCheckOutcome =
	| {
			outcome: "passed" | "failed";
			/** Whether the settings the check covers exist at all. */
			configured: boolean;
			/** Empty when passed. */
			failures: GoLiveFailureGroup[];
			/** Advisory findings that never block readiness. */
			warnings: GoLiveFailureGroup[];
			/** Passes worth explaining, such as built-in skips. */
			notes: GoLiveMessage[];
			/** Overrides the check's declared severity for this run. */
			severity?: GoLiveCheckSeverity;
	  }
	| { outcome: "unavailable" };

/** A check's outcome with what the readiness resolver needs to place it. */
export type GoLiveCheckResult = GoLiveCheckOutcome & {
	checkId: string;
	itemId: ImplementationChecklistItemId;
	severity: GoLiveCheckSeverity;
	/** How many group members the check looked at. */
	checkedMemberCount: number;
};

/** Overall go-live readiness for the header. */
export type GoLiveReadiness =
	| { status: "ready"; warnings: GoLiveFailureGroup[] }
	| { status: "not-ready"; affectedMemberCount: number; warnings: GoLiveFailureGroup[] }
	| { status: "unavailable" };

/** A stable key for a member across checks. */
export function goLiveMemberKey(member: GoLiveMember): string {
	return member.kind === "employee" ? `employee:${member.employeeId}` : `invitee:${member.draftId}`;
}
