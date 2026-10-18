import { db as applicationDatabase } from "@/db";
import { type Clock, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import type { EmployeePeriodViewRow } from "./employee-period-view";
import { loadEmployeePeriodViewWithPeriods } from "./employee-period-view-store";
import type { ExpectedSubmissionPeriod } from "./expected-periods";
import { findPeriodSubmissionBlockers, type PeriodSubmissionBlocker } from "./submission-blockers";
import { canRoutePeriodSubmission, type PeriodSubmitter } from "./submission-routing";
import {
	findExpectedSubmissionPeriod,
	findPeriodSubmitter,
	hasPeriodSubmissionOpened,
	type PeriodSubmissionRefusal,
	periodSubmissionBounds,
} from "./submission-service";
import { findLivePeriodSubmission } from "./submission-store";

type Database = typeof applicationDatabase;

/**
 * Period submission readiness (#1348): whether the employee's period currently meets every
 * precondition submitting checks (`submitPeriodSubmission`), read with the same rules and
 * writing nothing. Advisory: it never certifies that the recorded work is complete, and
 * submitting repeats every check.
 *
 * Plain data; crosses to the client.
 */
export interface PeriodSubmissionReadiness {
	/** Submitting now would pass every precondition. */
	ready: boolean;
	/**
	 * Every refusal submitting now would meet, in the order submitting checks them (the first is
	 * the one it would give); empty when ready. A period that has not opened yet still lists its
	 * content and routing refusals. A submitted or approved period stops at `already_submitted`.
	 */
	refusals: PeriodSubmissionRefusal[];
	/** What keeps the period open (`period_open`), in submission's order and identities. */
	blockers: PeriodSubmissionBlocker[];
	/** The period's last local day, when submitting opens; null for a period not expected. */
	opensOn: string | null;
}

/** One displayed period with its readiness. */
export interface EmployeePeriodReadinessRow extends EmployeePeriodViewRow {
	readiness: PeriodSubmissionReadiness;
}

export interface EmployeePeriodReadinessView {
	/** The signed-in user's employee the view was read for. */
	employeeId: string;
	timezone: string;
	periods: EmployeePeriodReadinessRow[];
}

const refused = (refusal: PeriodSubmissionRefusal): PeriodSubmissionReadiness => ({
	ready: false,
	refusals: [refusal],
	blockers: [],
	opensOn: null,
});

interface Dependencies {
	database?: Database;
	clock?: Clock;
}

/**
 * Reads in one read-only transaction: one snapshot for every period, and PostgreSQL itself
 * refuses any write. The loaders take the application database type; the transaction has the
 * same query surface.
 */
function readOnly<T>(database: Database, read: (reader: Database) => Promise<T>): Promise<T> {
	return database.transaction((tx) => read(tx as unknown as Database), {
		accessMode: "read only",
		isolationLevel: "repeatable read",
	});
}

/** Routing is the employee's, not the period's: planned once per read, when first needed. */
function routingOnce(reader: Database, submitter: PeriodSubmitter, now: Instant) {
	let routable: Promise<boolean> | null = null;
	return () => {
		routable ??= canRoutePeriodSubmission(reader, { ...submitter, now });
		return routable;
	};
}

async function assessExpectedPeriod(
	reader: Database,
	input: {
		submitter: PeriodSubmitter;
		period: ExpectedSubmissionPeriod;
		now: Instant;
		routable: () => Promise<boolean>;
	},
): Promise<PeriodSubmissionReadiness> {
	const { submitter, period } = input;
	const opensOn = period.endDate.toString();
	const refusals: PeriodSubmissionRefusal[] = [];
	if (!hasPeriodSubmissionOpened(period, input.now)) refusals.push("period_not_ended");
	const live = await findLivePeriodSubmission(reader, {
		organizationId: submitter.organizationId,
		employeeId: submitter.employeeId,
		startDate: period.startDate.toString(),
	});
	if (live)
		return { ready: false, refusals: [...refusals, "already_submitted"], blockers: [], opensOn };
	const blockers = await findPeriodSubmissionBlockers(
		reader,
		periodSubmissionBounds(submitter.organizationId, submitter.employeeId, period),
	);
	if (blockers.length > 0) refusals.push("period_open");
	if (!(await input.routable())) refusals.push("no_approver");
	return { ready: refusals.length === 0, refusals, blockers, opensOn };
}

/**
 * The readiness of one of the user's own periods, named as `submitPeriodSubmission` names it.
 * The employee is the user's active employee in the organization (else `not_employee`); a period
 * they are not expected to submit is `not_expected`.
 */
export async function assessPeriodSubmissionReadiness(
	input: { organizationId: string; userId: string; periodStartDate: string },
	dependencies: Dependencies = {},
): Promise<PeriodSubmissionReadiness> {
	const database = dependencies.database ?? applicationDatabase;
	const now = (dependencies.clock ?? systemClock).nowInstant();
	return readOnly(database, async (reader) => {
		const submitter = await findPeriodSubmitter(reader, input);
		if (!submitter) return refused("not_employee");
		const period = await findExpectedSubmissionPeriod(reader, {
			organizationId: input.organizationId,
			employeeId: submitter.employeeId,
			periodStartDate: input.periodStartDate,
		});
		if (!period) return refused("not_expected");
		return assessExpectedPeriod(reader, {
			submitter,
			period,
			now,
			routable: routingOnce(reader, submitter, now),
		});
	});
}

/**
 * The user's period view (#1059) with every displayed period assessed. Null when they have no
 * active employee in the organization, or the organization collects no periods from them.
 */
export async function loadEmployeePeriodReadinessView(
	input: { organizationId: string; userId: string },
	dependencies: Dependencies = {},
): Promise<EmployeePeriodReadinessView | null> {
	const database = dependencies.database ?? applicationDatabase;
	const now = (dependencies.clock ?? systemClock).nowInstant();
	return readOnly(database, async (reader) => {
		const submitter = await findPeriodSubmitter(reader, input);
		if (!submitter) return null;
		const view = await loadEmployeePeriodViewWithPeriods(reader, {
			organizationId: input.organizationId,
			employeeId: submitter.employeeId,
			now,
		});
		if (!view) return null;
		const routable = routingOnce(reader, submitter, now);
		const periods: EmployeePeriodReadinessRow[] = [];
		// One at a time: the reads share the transaction's connection.
		for (const row of view.periods) {
			const period = view.expected.find(
				(candidate) => candidate.startDate.toString() === row.startDate,
			);
			const readiness = period
				? await assessExpectedPeriod(reader, { submitter, period, now, routable })
				: refused("not_expected");
			periods.push({ ...row, readiness });
		}
		return { employeeId: submitter.employeeId, timezone: view.timezone, periods };
	});
}
