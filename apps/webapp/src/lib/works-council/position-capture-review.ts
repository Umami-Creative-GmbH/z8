/**
 * The works-council portal's read-only position capture section (#834, spec
 * #766, Time Tracking ADR 0004): the configuration, the notice history, consent
 * counts and the position stamp access log, with names following the works
 * council's `identityVisibility`. Positions are never part of it: the source
 * carries none, so the portal and its export cannot render one.
 *
 * This file has no I/O; `position-capture-review-data.ts` loads the source.
 */
import type { WorksCouncilIdentityVisibility } from "@/db/schema/works-council";
import { type Instant, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import {
	captureAssignedTo,
	type PositionCaptureAssignmentRule,
	type PositionCaptureSettings,
	type PositionConsentRecord,
	type PositionNoticeDeclineRecord,
	positionConsentDecision,
} from "@/lib/time-tracking/position-capture/policy";

export type PositionCaptureReviewNotice = {
	id: string;
	version: number;
	purposeStatement: string;
	retentionDays: number;
	templateRevision: number;
	createdAt: Instant;
};

export type PositionCaptureReviewAssignment = {
	id: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	teamName?: string | null;
	employeeId: string | null;
	captureEnabled: boolean;
};

export type PositionCaptureReviewSource = {
	settings: PositionCaptureSettings;
	/** Newest version first. */
	notices: PositionCaptureReviewNotice[];
	assignments: PositionCaptureReviewAssignment[];
	/** The organization's active employees with their consent records. */
	employees: Array<{
		employeeId: string;
		teamId: string | null;
		consents: PositionConsentRecord[];
		declines: PositionNoticeDeclineRecord[];
	}>;
	/** Display names of every employee the section may reference, by employee id. */
	employeeNames: Record<string, string>;
	accessLog: Array<{
		id: string;
		kind: "work_period_detail" | "data_export";
		accessedAt: Instant;
		viewer: { userId: string; name: string } | null;
		subjectEmployeeIds: string[];
		workPeriods: Array<{ id: string }>;
	}>;
};

export type PositionCaptureReviewVisibility = {
	identityVisibility: WorksCouncilIdentityVisibility;
	minimumAggregationThreshold: number;
};

/**
 * Consent counts among the employees capture is switched on for right now:
 * active employees whose most specific assignment is on while the master switch
 * is on (the same rule the clock path uses).
 *
 * - `active`: consent to the current notice version that is not withdrawn.
 * - `withdrawn`: their latest answer is a withdrawal and they have not agreed
 *   again since.
 * - `undecided`: everyone else switched on: no answer to the current version
 *   yet, "Not now" on it, or consent only to an earlier version (lapsed).
 *
 * The three always add up to `switchedOnEmployees`. Below the works council's
 * minimum aggregation threshold the counts are withheld.
 */
export type PositionConsentCounts =
	| {
			state: "available";
			switchedOnEmployees: number;
			active: number;
			withdrawn: number;
			undecided: number;
	  }
	| { state: "insufficient_data"; switchedOnEmployees: number };

/**
 * How a person appears in the section. `named` only under "named" identity
 * visibility; `pseudonym` refs are letters stable within one rendering,
 * assigned in id order so they reveal nothing about names.
 */
export type PositionCaptureReviewIdentity =
	| { kind: "named"; name: string }
	| { kind: "pseudonym"; ref: string }
	| { kind: "hidden" };

export type PositionCaptureReviewNoticeView = {
	version: number;
	purposeStatement: string;
	retentionDays: number;
	templateRevision: number;
	/** ISO instant. */
	publishedAt: string;
};

export type PositionCaptureReview = {
	enabled: boolean;
	retentionDays: number;
	currentNotice: PositionCaptureReviewNoticeView | null;
	/** Newest version first, the current one included. */
	noticeHistory: PositionCaptureReviewNoticeView[];
	/** The organization-wide assignment, if one exists. */
	organizationAssignment: boolean | null;
	teamAssignments: Array<{ teamName: string; captureEnabled: boolean }>;
	/** Listed per employee where identities may be referenced, otherwise only counted. */
	employeeAssignments:
		| {
				state: "listed";
				rows: Array<{ employee: PositionCaptureReviewIdentity; captureEnabled: boolean }>;
		  }
		| { state: "counted"; switchedOn: number; switchedOff: number };
	consentCounts: PositionConsentCounts;
	/** Newest first. Never contains a position: only who looked, at whose, when and how. */
	accessLog: PositionCaptureReviewAccessEntry[];
};

export type PositionCaptureReviewAccessEntry = {
	id: string;
	kind: "work_period_detail" | "data_export";
	/** ISO instant. */
	accessedAt: string;
	/** `deleted` once the viewer's account is gone (only where identities may be referenced). */
	viewer: PositionCaptureReviewIdentity | { kind: "deleted" };
	employees:
		| { state: "listed"; identities: PositionCaptureReviewIdentity[] }
		| { state: "counted"; count: number };
	workPeriodCount: number;
};

export function buildPositionCaptureReview(
	source: PositionCaptureReviewSource,
	visibility: PositionCaptureReviewVisibility,
): PositionCaptureReview {
	const employeeIdentity = identities(
		visibility.identityVisibility,
		[
			...source.assignments.flatMap((row) => (row.employeeId ? [row.employeeId] : [])),
			...source.accessLog.flatMap((entry) => entry.subjectEmployeeIds),
		],
		(employeeId) => source.employeeNames[employeeId],
	);
	const viewerNames = new Map(
		source.accessLog.flatMap((entry) =>
			entry.viewer ? [[entry.viewer.userId, entry.viewer.name] as const] : [],
		),
	);
	const viewerIdentity = identities(
		visibility.identityVisibility,
		[...viewerNames.keys()],
		(userId) => viewerNames.get(userId),
	);
	const notices = source.notices.map(toNoticeView);
	const organization = source.assignments.find((row) => row.assignmentType === "organization");
	const employeeRows = source.assignments.filter(
		(row): row is PositionCaptureReviewAssignment & { employeeId: string } =>
			row.assignmentType === "employee" && row.employeeId !== null,
	);

	return {
		enabled: source.settings.enabled,
		retentionDays: source.settings.retentionDays,
		currentNotice: notices[0] ?? null,
		noticeHistory: notices,
		organizationAssignment: organization ? organization.captureEnabled : null,
		teamAssignments: source.assignments
			.filter((row) => row.assignmentType === "team")
			.map((row) => ({ teamName: row.teamName ?? "", captureEnabled: row.captureEnabled }))
			.sort((left, right) => left.teamName.localeCompare(right.teamName)),
		employeeAssignments:
			visibility.identityVisibility === "aggregated"
				? {
						state: "counted",
						switchedOn: employeeRows.filter((row) => row.captureEnabled).length,
						switchedOff: employeeRows.filter((row) => !row.captureEnabled).length,
					}
				: {
						state: "listed",
						rows: employeeRows
							.map((row) => ({
								employee: employeeIdentity(row.employeeId),
								captureEnabled: row.captureEnabled,
							}))
							.sort((left, right) =>
								identitySortKey(left.employee).localeCompare(identitySortKey(right.employee)),
							),
					},
		consentCounts: countConsents(source, visibility),
		accessLog: source.accessLog.map((entry) => ({
			id: entry.id,
			kind: entry.kind,
			accessedAt: instantToCanonicalString(entry.accessedAt),
			viewer:
				visibility.identityVisibility === "aggregated"
					? { kind: "hidden" }
					: entry.viewer
						? viewerIdentity(entry.viewer.userId)
						: { kind: "deleted" },
			employees:
				visibility.identityVisibility === "aggregated"
					? { state: "counted", count: entry.subjectEmployeeIds.length }
					: {
							state: "listed",
							identities: entry.subjectEmployeeIds
								.map(employeeIdentity)
								.sort((left, right) => identitySortKey(left).localeCompare(identitySortKey(right))),
						},
			workPeriodCount: entry.workPeriods.length,
		})),
	};
}

/**
 * The section as CSV rows (cells unquoted) for the works-council review export.
 * Labels are English, like the rest of that export.
 */
export function positionCaptureReviewCsvRows(review: PositionCaptureReview): unknown[][] {
	const onOff = (enabled: boolean) => (enabled ? "on" : "off");
	const rows: unknown[][] = [
		["Position capture"],
		["Position capture enabled", review.enabled ? "yes" : "no"],
		["Position retention days", review.retentionDays],
		["Current position notice version", review.currentNotice?.version ?? "none"],
		[
			"Organization assignment",
			review.organizationAssignment === null ? "none" : onOff(review.organizationAssignment),
		],
		...review.teamAssignments.map((row) => [
			"Team assignment",
			row.teamName,
			onOff(row.captureEnabled),
		]),
	];
	if (review.employeeAssignments.state === "counted") {
		rows.push(
			["Employee assignments switched on", review.employeeAssignments.switchedOn],
			["Employee assignments switched off", review.employeeAssignments.switchedOff],
		);
	} else {
		for (const row of review.employeeAssignments.rows) {
			rows.push([
				"Employee assignment",
				csvIdentity(row.employee, "Employee"),
				onOff(row.captureEnabled),
			]);
		}
	}
	const counts = review.consentCounts;
	rows.push(["Consent: switched-on employees", counts.switchedOnEmployees]);
	if (counts.state === "available") {
		rows.push(
			["Consent: active", counts.active],
			["Consent: withdrawn", counts.withdrawn],
			["Consent: undecided", counts.undecided],
		);
	} else {
		rows.push(["Consent counts", "insufficient_data"]);
	}
	rows.push(
		[],
		["Notice version", "Published at", "Retention days", "Template revision", "Purpose"],
		...review.noticeHistory.map((notice) => [
			notice.version,
			notice.publishedAt,
			notice.retentionDays,
			notice.templateRevision,
			notice.purposeStatement,
		]),
		[],
		["Position access at", "Kind", "Viewer", "Employees", "Work periods"],
		...review.accessLog.map((entry) => [
			entry.accessedAt,
			entry.kind,
			entry.viewer.kind === "deleted" ? "deleted user" : csvIdentity(entry.viewer, "Viewer"),
			entry.employees.state === "counted"
				? `${entry.employees.count} employee(s)`
				: entry.employees.identities
						.map((identity) => csvIdentity(identity, "Employee"))
						.join("; "),
			entry.workPeriodCount,
		]),
	);
	return rows;
}

function csvIdentity(identity: PositionCaptureReviewIdentity, prefix: string): string {
	if (identity.kind === "named") return identity.name;
	if (identity.kind === "pseudonym") return `${prefix} ${identity.ref}`;
	return "hidden";
}

function toNoticeView(notice: PositionCaptureReviewNotice): PositionCaptureReviewNoticeView {
	return {
		version: notice.version,
		purposeStatement: notice.purposeStatement,
		retentionDays: notice.retentionDays,
		templateRevision: notice.templateRevision,
		publishedAt: instantToCanonicalString(notice.createdAt),
	};
}

/**
 * Maps ids to identities under the visibility: names, pseudonym letters given
 * out in sorted id order, or nothing at all.
 */
function identities(
	visibility: WorksCouncilIdentityVisibility,
	ids: readonly string[],
	nameOf: (id: string) => string | undefined,
): (id: string) => PositionCaptureReviewIdentity {
	if (visibility === "aggregated") return () => ({ kind: "hidden" });
	if (visibility === "named") {
		return (id) => {
			const name = nameOf(id)?.trim();
			return name ? { kind: "named", name } : { kind: "hidden" };
		};
	}
	const refs = new Map(
		[...new Set(ids)].sort().map((id, index) => [id, pseudonymRef(index)] as const),
	);
	return (id) => {
		const ref = refs.get(id);
		return ref ? { kind: "pseudonym", ref } : { kind: "hidden" };
	};
}

/** A, B, …, Z, AA, AB, … */
function pseudonymRef(index: number): string {
	let ref = "";
	let rest = index;
	do {
		ref = String.fromCharCode(65 + (rest % 26)) + ref;
		rest = Math.floor(rest / 26) - 1;
	} while (rest >= 0);
	return ref;
}

function identitySortKey(identity: PositionCaptureReviewIdentity): string {
	if (identity.kind === "named") return identity.name;
	if (identity.kind === "pseudonym") return identity.ref.padStart(4, " ");
	return "";
}

function countConsents(
	source: PositionCaptureReviewSource,
	visibility: PositionCaptureReviewVisibility,
): PositionConsentCounts {
	const rules = source.assignments.flatMap(toAssignmentRule);
	const current = source.notices[0] ?? null;
	const counts = { active: 0, withdrawn: 0, undecided: 0 };
	let switchedOnEmployees = 0;
	for (const subject of source.employees) {
		if (!source.settings.enabled || !captureAssignedTo(subject, rules)) continue;
		switchedOnEmployees += 1;
		const decision = positionConsentDecision({
			notice: current,
			consents: subject.consents,
			declines: subject.declines,
		});
		if (decision.kind === "active") counts.active += 1;
		else if (decision.kind === "withdrawn") counts.withdrawn += 1;
		else counts.undecided += 1;
	}
	if (switchedOnEmployees < visibility.minimumAggregationThreshold) {
		return { state: "insufficient_data", switchedOnEmployees };
	}
	return { state: "available", switchedOnEmployees, ...counts };
}

function toAssignmentRule(row: PositionCaptureReviewAssignment): PositionCaptureAssignmentRule[] {
	if (row.assignmentType === "organization") {
		return [{ assignmentType: "organization", captureEnabled: row.captureEnabled }];
	}
	if (row.assignmentType === "team" && row.teamId) {
		return [{ assignmentType: "team", teamId: row.teamId, captureEnabled: row.captureEnabled }];
	}
	if (row.assignmentType === "employee" && row.employeeId) {
		return [
			{
				assignmentType: "employee",
				employeeId: row.employeeId,
				captureEnabled: row.captureEnabled,
			},
		];
	}
	return [];
}
