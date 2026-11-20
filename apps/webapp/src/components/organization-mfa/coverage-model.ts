import { Temporal } from "temporal-polyfill";

/** The JSON shape returned by `GET /api/organization-mfa/policy`. */
export interface OrganizationMfaCoverage {
	enabled: boolean;
	gracePeriodDays: number;
	updatedAt: string | null;
	timezone: string;
	members: MemberCoverage[];
}

export interface MemberCoverage {
	userId: string;
	name: string;
	email: string | null;
	isAdministrator: boolean;
	kioskOnly: boolean;
	methods: string[];
	deadline: string | null;
	enforced: boolean;
	lastQualifyingAccessAt: string | null;
}

/**
 * - `blocked`: the requirement applies now and the member has no method.
 * - `due`: the member has no method yet and an enrollment deadline is still ahead.
 * - `unenrolled`: no method, and nothing is currently enforced (policy off or out of reach).
 * - `enrolled`: at least one qualifying method is enrolled.
 * - `outside`: kiosk-only accounts are outside the policy's scope.
 */
export type MemberCoverageStatus = "blocked" | "due" | "unenrolled" | "enrolled" | "outside";

export function memberCoverageStatus(
	person: MemberCoverage,
	policyEnabled: boolean,
): MemberCoverageStatus {
	if (person.kioskOnly) return "outside";
	if (person.methods.length > 0) return "enrolled";
	if (!policyEnabled) return "unenrolled";
	if (person.enforced) return "blocked";
	if (person.deadline) return "due";
	return "unenrolled";
}

const STATUS_ORDER: Record<MemberCoverageStatus, number> = {
	blocked: 0,
	due: 1,
	unenrolled: 2,
	enrolled: 3,
	outside: 4,
};

export interface CoverageRow extends MemberCoverage {
	status: MemberCoverageStatus;
}

/** Members who need attention first, then earliest deadline, then name. */
export function coverageRows(coverage: OrganizationMfaCoverage): CoverageRow[] {
	return coverage.members
		.map((person) => ({ ...person, status: memberCoverageStatus(person, coverage.enabled) }))
		.sort(
			(a, b) =>
				STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
				compareDeadlines(a.deadline, b.deadline) ||
				a.name.localeCompare(b.name),
		);
}

function compareDeadlines(a: string | null, b: string | null) {
	if (a === b) return 0;
	if (!a) return 1;
	if (!b) return -1;
	return Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b));
}

export interface CoverageSummary {
	/** Members the policy applies to (everyone except kiosk-only accounts). */
	inScope: number;
	enrolled: number;
	blocked: number;
	due: number;
	unenrolled: number;
	outside: number;
	administrators: number;
	administratorsEnrolled: number;
	/** Whole percentage of in-scope members with an enrolled method. */
	percentEnrolled: number;
}

export function summarizeCoverage(rows: readonly CoverageRow[]): CoverageSummary {
	const summary: CoverageSummary = {
		inScope: 0,
		enrolled: 0,
		blocked: 0,
		due: 0,
		unenrolled: 0,
		outside: 0,
		administrators: 0,
		administratorsEnrolled: 0,
		percentEnrolled: 0,
	};
	for (const row of rows) {
		summary[row.status] += 1;
		if (row.status !== "outside") summary.inScope += 1;
		if (row.isAdministrator) {
			summary.administrators += 1;
			if (row.status === "enrolled") summary.administratorsEnrolled += 1;
		}
	}
	summary.percentEnrolled = summary.inScope
		? Math.floor((summary.enrolled / summary.inScope) * 100)
		: 0;
	return summary;
}

export type CoverageFilter = "all" | "attention" | "enrolled" | "outside";

export function matchesCoverageFilter(row: CoverageRow, filter: CoverageFilter) {
	switch (filter) {
		case "all":
			return true;
		case "attention":
			return row.status === "blocked" || row.status === "due" || row.status === "unenrolled";
		case "enrolled":
			return row.status === "enrolled";
		case "outside":
			return row.status === "outside";
	}
}

export function matchesCoverageSearch(row: CoverageRow, query: string) {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return true;
	return (
		row.name.toLocaleLowerCase().includes(needle) ||
		(row.email?.toLocaleLowerCase().includes(needle) ?? false)
	);
}

/** Compact organization-zone timestamp for table cells; the zone is stated once beside the table. */
export function formatCoverageInstant(value: string, zone: string, locale: string) {
	let zoned: Temporal.ZonedDateTime;
	try {
		zoned = Temporal.Instant.from(value).toZonedDateTimeISO(zone || "UTC");
	} catch {
		zoned = Temporal.Instant.from(value).toZonedDateTimeISO("UTC");
	}
	return zoned.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
