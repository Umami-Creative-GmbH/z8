/**
 * Read models and the one command behind the short-term surfaces (#1990): the Employee Detail
 * monitor card, the Berufsmäßigkeit verification in Settings → Contracts → Reviews & Conflicts,
 * and its audited acknowledgement.
 */
import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { employee, employeeEmploymentHistory, employeeStatutoryOffset } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { plainDateAt } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	attachAcknowledgementStates,
	loadStatutoryAcknowledgementStates,
	recordStatutoryAcknowledgement,
	type StatutoryAcknowledgementRecord,
	statutoryAcknowledgementSubjectOf,
} from "../acknowledgements";
import { loadEmployeeInOrganization } from "../employee-scope";
import type { StatutoryFinding } from "../finding";
import {
	acknowledgedTotalCentsOf,
	minijobAcknowledgementStatus,
	minijobTotalCoveredBy,
} from "../minijob/minijob-months";
import {
	type RedactedStatutoryFinding,
	redactStatutoryFinding,
	type StatutoryAudience,
} from "../redaction";
import { evaluateShortTermEmployment, type ShortTermAllowance } from "./evaluate";
import type { ShortTermReader } from "./load-inputs";

export const BERUFSMAESSIGKEIT_FINDING_KIND = "short_term_berufsmaessigkeit_check";

/** A recorded prior-employer short-term period of one calendar year (org admins only). */
export interface ShortTermPriorEmployment {
	readonly id: string;
	readonly kind: "prior_short_term_work_days" | "prior_short_term_months";
	readonly calendarYear: number;
	readonly count: number;
	readonly sourceEmployer: string | null;
	readonly note: string;
	readonly createdAt: Date;
}

export interface ShortTermMonitor {
	readonly employeeId: string;
	readonly year: number;
	readonly audience: StatutoryAudience;
	/** Whether the employee has confirmed short-term terms in the year. */
	readonly applies: boolean;
	/** Wage-free allowance; null when it does not apply or no baseline covers the year. */
	readonly allowance: ShortTermAllowance | null;
	/**
	 * The allowance finding and, for org admins only, the Berufsmäßigkeit prompts with their
	 * acknowledgement state. Restricted readers never get earnings findings, not even their tier.
	 */
	readonly findings: readonly (StatutoryFinding | RedactedStatutoryFinding)[];
	/** Prior-employer entries of the year; null for restricted readers. */
	readonly priorEmployment: readonly ShortTermPriorEmployment[] | null;
}

type Writer = Pick<DatabaseClient, "select" | "insert">;

/**
 * A prompt's month total and one material step of it (15 minutes' pay at the month's highest
 * wage), in cents, from its admin detail.
 */
function promptTotalOf(finding: StatutoryFinding) {
	const step = finding.adminDetail?.facts?.materialRiseCents;
	return {
		totalCents: finding.adminDetail?.amountsCents?.total ?? 0,
		materialRiseCents: typeof step === "number" ? step : 0,
	};
}

/**
 * Attaches each Berufsmäßigkeit prompt's acknowledgement state, by fingerprint and documented
 * total as for Minijob months (`minijobAcknowledgementStatus`): an acknowledgement matching the
 * fingerprint stays current only while the month's total is at most one material step above the
 * total it documented, so a clock-in without a shift that keeps running makes it stale.
 */
async function attachBerufsmaessigkeitStates(
	db: ShortTermReader,
	organizationId: string,
	findings: readonly StatutoryFinding[],
): Promise<StatutoryFinding[]> {
	const subjectOf = (finding: StatutoryFinding) =>
		finding.kind === BERUFSMAESSIGKEIT_FINDING_KIND
			? statutoryAcknowledgementSubjectOf(finding)
			: null;
	const states = await loadStatutoryAcknowledgementStates(db, {
		organizationId,
		subjects: findings.flatMap((finding) => {
			const subject = subjectOf(finding);
			return subject ? [{ ...subject, inputFingerprint: finding.inputFingerprint }] : [];
		}),
	});
	return findings.map((finding) => {
		const subject = subjectOf(finding);
		if (!subject) return finding;
		const state = states.get(subject);
		return {
			...finding,
			acknowledgement: {
				status: minijobAcknowledgementStatus(promptTotalOf(finding), {
					status: state.status,
					acknowledgedTotalCents: state.latest
						? acknowledgedTotalCentsOf(state.latest.metadata)
						: null,
				}),
				acknowledgedAt: state.latest?.acknowledgedAt ?? null,
				acknowledgedBy: state.latest?.acknowledgedBy ?? null,
				reason: state.latest?.reason ?? null,
			},
		};
	});
}

async function evaluateYearWithAcknowledgements(
	db: ShortTermReader,
	input: {
		readonly organizationId: string;
		readonly timezone: string;
		readonly employeeIds: readonly string[];
		readonly years: readonly number[];
		readonly now: Instant;
	},
) {
	const evaluations = await evaluateShortTermEmployment(db, input);
	const findings = await attachAcknowledgementStates(
		db,
		input.organizationId,
		await attachBerufsmaessigkeitStates(
			db,
			input.organizationId,
			evaluations.flatMap((evaluation) => evaluation.findings),
		),
	);
	return { evaluations, findings };
}

export async function loadShortTermMonitor(
	db: ShortTermReader,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly timezone: string;
		readonly year: number;
		readonly now: Instant;
		readonly audience: StatutoryAudience;
	},
): Promise<ShortTermMonitor> {
	await loadEmployeeInOrganization(db, input);
	const { evaluations, findings } = await evaluateYearWithAcknowledgements(db, {
		organizationId: input.organizationId,
		timezone: input.timezone,
		employeeIds: [input.employeeId],
		years: [input.year],
		now: input.now,
	});
	const evaluation = evaluations[0];
	const visible =
		input.audience === "full"
			? findings
			: findings
					.filter((finding) => !finding.earningsDerived)
					.map((finding) => redactStatutoryFinding(finding, "restricted"));

	let priorEmployment: ShortTermPriorEmployment[] | null = null;
	if (input.audience === "full") {
		const rows = await db
			.select()
			.from(employeeStatutoryOffset)
			.where(
				and(
					eq(employeeStatutoryOffset.organizationId, input.organizationId),
					eq(employeeStatutoryOffset.employeeId, input.employeeId),
					inArray(employeeStatutoryOffset.offsetKind, [
						"prior_short_term_work_days",
						"prior_short_term_months",
					]),
					isNull(employeeStatutoryOffset.voidedAt),
					eq(employeeStatutoryOffset.validFromDate, `${input.year}-01-01`),
				),
			)
			.orderBy(asc(employeeStatutoryOffset.createdAt));
		priorEmployment = rows.map((row) => ({
			id: row.id,
			kind: row.offsetKind as ShortTermPriorEmployment["kind"],
			calendarYear: input.year,
			count: row.countValue ?? 0,
			sourceEmployer: row.sourceEmployer,
			note: row.note,
			createdAt: row.createdAt,
		}));
	}

	return {
		employeeId: input.employeeId,
		year: input.year,
		audience: input.audience,
		applies: evaluation !== undefined,
		allowance: evaluation?.allowance ?? null,
		findings: visible,
		priorEmployment,
	};
}

export type ShortTermAcknowledgementRefusal =
	| "short_term_no_verification_prompt"
	| "short_term_figures_changed";

/**
 * Records an org admin's Berufsmäßigkeit verification for `month` (`YYYY-MM`). The month is
 * evaluated again here; `expectedFingerprint` and `expectedTotalCents` are the fingerprint and
 * total of the prompt the admin was looking at. A different fingerprint, or a total now more than
 * one material step above the shown one, is refused, so nobody acknowledges figures they never
 * saw. The re-evaluated fingerprint and exactly the shown total are recorded; the acknowledgement
 * goes stale when the month's work, shifts, wages or cap change, or its total rises more than a
 * step above the documented one. The caller authorizes (org admin).
 */
export async function acknowledgeShortTermBerufsmaessigkeit(
	db: Writer,
	input: {
		readonly organizationId: string;
		readonly actorUserId: string;
		readonly employeeId: string;
		readonly timezone: string;
		readonly month: string;
		readonly reason: string;
		readonly legalNote?: string | null;
		/** The fingerprint of the prompt as shown to the admin. */
		readonly expectedFingerprint: string;
		/** The month's total in cents as shown to the admin. */
		readonly expectedTotalCents: number;
		readonly now: Instant;
	},
): Promise<StatutoryAcknowledgementRecord> {
	await loadEmployeeInOrganization(db, input);
	const year = Number(input.month.slice(0, 4));
	const evaluations = await evaluateShortTermEmployment(db, {
		organizationId: input.organizationId,
		timezone: input.timezone,
		employeeIds: [input.employeeId],
		years: [year],
		now: input.now,
	});
	const finding = evaluations
		.flatMap((evaluation) => evaluation.findings)
		.find(
			(candidate) =>
				candidate.kind === BERUFSMAESSIGKEIT_FINDING_KIND && candidate.subjectKey === input.month,
		);
	const subject = finding ? statutoryAcknowledgementSubjectOf(finding) : null;
	if (!finding || !subject) {
		throw new ValidationError({
			message: "This month's earnings do not exceed the Minijob limit",
			field: "month",
			refusal: "short_term_no_verification_prompt" satisfies ShortTermAcknowledgementRefusal,
		});
	}
	if (
		finding.inputFingerprint !== input.expectedFingerprint ||
		!minijobTotalCoveredBy(promptTotalOf(finding), input.expectedTotalCents)
	) {
		throw new ValidationError({
			message: "This month's earnings changed since they were shown",
			field: "month",
			refusal: "short_term_figures_changed" satisfies ShortTermAcknowledgementRefusal,
		});
	}
	return recordStatutoryAcknowledgement(db, {
		...subject,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		inputFingerprint: finding.inputFingerprint,
		reason: input.reason,
		legalNote: input.legalNote ?? null,
		metadata: {
			// What the admin verified (org admins only): a later rise beyond it makes it stale.
			documentedTotalCents: input.expectedTotalCents,
			// The evaluated breakdown as it is now, for the audit trail.
			amountsCents: finding.adminDetail?.amountsCents ?? {},
		},
		// Documenting a risen total of an unchanged fingerprint records a new acknowledgement.
		revision: `total:${input.expectedTotalCents}`,
	});
}

/** A Berufsmäßigkeit prompt in the Reviews & Conflicts inbox (org admins only). */
export interface ShortTermBerufsmaessigkeitReview {
	readonly employeeId: string;
	readonly employeeName: string;
	readonly month: string;
	readonly finding: StatutoryFinding;
}

/**
 * Berufsmäßigkeit prompts of the organization's short-term employees in the previous, the current
 * and the next calendar year: open ones (no or a stale acknowledgement), and with `includeResolved`
 * also those with a current one. Org admins only: the findings carry EUR amounts.
 */
export async function listShortTermBerufsmaessigkeitReviews(
	db: ShortTermReader,
	input: {
		readonly organizationId: string;
		readonly timezone: string;
		readonly now: Instant;
		readonly includeResolved?: boolean;
	},
): Promise<ShortTermBerufsmaessigkeitReview[]> {
	const year = plainDateAt(input.now, input.timezone).year;
	// Next year too: the monitor card shows it once it is planned (a fixed term across the year end,
	// next January's rota), and this inbox is where its prompts are documented.
	const years = [year - 1, year, year + 1];
	const rows = await db
		.select({
			employeeId: employeeEmploymentHistory.employeeId,
			firstName: employee.firstName,
			lastName: employee.lastName,
		})
		.from(employeeEmploymentHistory)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeEmploymentHistory.employeeId),
				eq(employee.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				eq(employeeEmploymentHistory.employmentProfile, "short_term"),
				lt(employeeEmploymentHistory.validFromDate, `${year + 2}-01-01`),
				or(
					isNull(employeeEmploymentHistory.validUntilDate),
					gt(employeeEmploymentHistory.validUntilDate, `${year - 1}-01-01`),
				),
			),
		);
	if (rows.length === 0) return [];
	const names = new Map(
		rows.map((row) => [
			row.employeeId,
			[row.firstName, row.lastName].filter(Boolean).join(" ") || row.employeeId,
		]),
	);
	const { findings } = await evaluateYearWithAcknowledgements(db, {
		organizationId: input.organizationId,
		timezone: input.timezone,
		employeeIds: [...names.keys()],
		years,
		now: input.now,
	});
	return findings
		.filter(
			(finding) =>
				finding.kind === BERUFSMAESSIGKEIT_FINDING_KIND &&
				(input.includeResolved || finding.acknowledgement?.status !== "current"),
		)
		.map((finding) => ({
			employeeId: finding.employeeId,
			employeeName: names.get(finding.employeeId) ?? finding.employeeId,
			month: finding.subjectKey,
			finding,
		}))
		.sort((a, b) => b.month.localeCompare(a.month) || a.employeeName.localeCompare(b.employeeName));
}
