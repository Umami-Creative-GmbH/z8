import { asc, desc, eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import {
	periodSubmissionCadenceChange,
	periodSubmissionSettings,
} from "@/db/schema/period-submission";
import { type Clock, dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	DEFAULT_SUBMISSION_WEEK_START_DAY,
	SUBMISSION_CADENCE_OFF,
	type SubmissionCadence,
	type SubmissionCadenceChange,
	sameSubmissionCadence,
	submissionCadenceStatusAt,
} from "./cadence";
import {
	DEFAULT_SECOND_REMINDER_DELAY_DAYS,
	type PeriodSubmissionSettings,
} from "./settings-policy";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;
type CadenceRow = Pick<
	typeof periodSubmissionCadenceChange.$inferSelect,
	"cadence" | "weekStartDay"
>;

function cadenceFromRow(row: CadenceRow): SubmissionCadence {
	if (row.cadence === "weekly") {
		return { kind: "weekly", weekStartDay: row.weekStartDay ?? DEFAULT_SUBMISSION_WEEK_START_DAY };
	}
	return row.cadence === "monthly" ? { kind: "monthly" } : { kind: "off" };
}

const cadenceColumns = {
	cadence: periodSubmissionCadenceChange.cadence,
	weekStartDay: periodSubmissionCadenceChange.weekStartDay,
	changedAt: periodSubmissionCadenceChange.changedAt,
};

/** The organization's saved cadences, oldest first: the input of the expected-period derivation. */
export async function loadSubmissionCadenceHistory(
	database: Reader,
	organizationId: string,
): Promise<SubmissionCadenceChange[]> {
	const rows = await database
		.select(cadenceColumns)
		.from(periodSubmissionCadenceChange)
		.where(eq(periodSubmissionCadenceChange.organizationId, organizationId))
		.orderBy(asc(periodSubmissionCadenceChange.changedAt), asc(periodSubmissionCadenceChange.id));
	return rows.map((row) => ({
		cadence: cadenceFromRow(row),
		changedAt: instantFromDate(row.changedAt),
	}));
}

/** The organization's period submission settings, with the cadence status in its timezone. */
export async function loadPeriodSubmissionSettings(
	database: Reader,
	organizationId: string,
	deps: { clock: Clock },
): Promise<PeriodSubmissionSettings> {
	const [settingsRows, history, timezone] = await Promise.all([
		database
			.select({
				secondReminderDelayDays: periodSubmissionSettings.secondReminderDelayDays,
				revision: periodSubmissionSettings.revision,
			})
			.from(periodSubmissionSettings)
			.where(eq(periodSubmissionSettings.organizationId, organizationId))
			.limit(1),
		loadSubmissionCadenceHistory(database, organizationId),
		loadOrganizationTimezone(database, organizationId),
	]);
	const status = submissionCadenceStatusAt(history, timezone, deps.clock.nowInstant());
	return {
		cadence: history.at(-1)?.cadence ?? { ...SUBMISSION_CADENCE_OFF },
		inEffect: status.inEffect,
		upcoming: status.upcoming
			? { cadence: status.upcoming.cadence, fromDate: status.upcoming.fromDate.toString() }
			: null,
		secondReminderDelayDays:
			settingsRows[0]?.secondReminderDelayDays ?? DEFAULT_SECOND_REMINDER_DELAY_DAYS,
		revision: settingsRows[0]?.revision ?? 0,
	};
}

/**
 * Saves the reminder delay and, when it differs from the cadence last saved, appends the cadence
 * to the history; the derivation decides when it takes effect. The settings row is upserted first,
 * so concurrent saves of one organization append in order. The caller must verify approved
 * owner/admin authorization before saving.
 */
export async function savePeriodSubmissionSettings(
	input: {
		organizationId: string;
		actorUserId: string;
		cadence: SubmissionCadence;
		secondReminderDelayDays: number;
	},
	deps: { database: Database; clock: Clock },
): Promise<PeriodSubmissionSettings> {
	const nowInstant = deps.clock.nowInstant();
	const now = dateFromInstant(nowInstant);
	await deps.database.transaction(async (tx) => {
		await tx
			.insert(periodSubmissionSettings)
			.values({
				organizationId: input.organizationId,
				secondReminderDelayDays: input.secondReminderDelayDays,
				revision: 1,
				createdAt: now,
				updatedAt: now,
				updatedBy: input.actorUserId,
			})
			.onConflictDoUpdate({
				target: periodSubmissionSettings.organizationId,
				set: {
					secondReminderDelayDays: input.secondReminderDelayDays,
					revision: sql`${periodSubmissionSettings.revision} + 1`,
					updatedAt: now,
					updatedBy: input.actorUserId,
				},
			});
		const [latest] = await tx
			.select(cadenceColumns)
			.from(periodSubmissionCadenceChange)
			.where(eq(periodSubmissionCadenceChange.organizationId, input.organizationId))
			.orderBy(
				desc(periodSubmissionCadenceChange.changedAt),
				desc(periodSubmissionCadenceChange.id),
			)
			.limit(1);
		const saved = latest ? cadenceFromRow(latest) : SUBMISSION_CADENCE_OFF;
		if (sameSubmissionCadence(saved, input.cadence)) return;
		await tx.insert(periodSubmissionCadenceChange).values({
			organizationId: input.organizationId,
			cadence: input.cadence.kind,
			weekStartDay: input.cadence.kind === "weekly" ? input.cadence.weekStartDay : null,
			changedAt: now,
			changedBy: input.actorUserId,
		});
	});
	return loadPeriodSubmissionSettings(deps.database, input.organizationId, {
		clock: { nowInstant: () => nowInstant },
	});
}
