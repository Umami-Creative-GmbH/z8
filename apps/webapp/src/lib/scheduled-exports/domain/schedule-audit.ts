/**
 * What a schedule update writes to the audit log (#988): one entry with a
 * before/after diff of the changed settings, and a separate pause or resume
 * entry when the schedule's active state changed.
 */

/** The schedule settings an update can change. */
export interface AuditedSchedule {
	name: string;
	description: string | null;
	scheduleType: string;
	cronExpression: string | null;
	timezone: string;
	reportType: string;
	reportConfig: unknown;
	payrollConfigId: string | null;
	filters: unknown;
	dateRangeStrategy: string;
	customOffset: unknown;
	deliveryMethod: string;
	emailRecipients: readonly string[];
	emailSubjectTemplate: string | null;
	isActive: boolean;
}

type SettingChange = { before: unknown; after: unknown };

export type ScheduleSettingChanges = Partial<
	Record<Exclude<keyof AuditedSchedule, "isActive" | "emailRecipients">, SettingChange>
> & {
	emailRecipients?: SettingChange & { added: string[]; removed: string[] };
};

export type ScheduleUpdateAuditEntry =
	| { kind: "updated"; changes: ScheduleSettingChanges }
	| { kind: "paused" }
	| { kind: "resumed" };

const SETTINGS = [
	"name",
	"description",
	"scheduleType",
	"cronExpression",
	"timezone",
	"reportType",
	"reportConfig",
	"payrollConfigId",
	"filters",
	"dateRangeStrategy",
	"customOffset",
	"deliveryMethod",
	"emailSubjectTemplate",
] as const satisfies ReadonlyArray<keyof AuditedSchedule>;

/** JSON with object keys sorted, so key order never counts as a change. */
function canonical(value: unknown): string {
	return JSON.stringify(value ?? null, (_key, nested: unknown) =>
		nested && typeof nested === "object" && !Array.isArray(nested)
			? Object.fromEntries(
					Object.entries(nested as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
				)
			: nested,
	);
}

export function scheduleUpdateAudit(
	before: AuditedSchedule,
	after: AuditedSchedule,
): ScheduleUpdateAuditEntry[] {
	const changes: ScheduleSettingChanges = {};
	for (const setting of SETTINGS) {
		if (canonical(before[setting]) !== canonical(after[setting])) {
			changes[setting] = { before: before[setting] ?? null, after: after[setting] ?? null };
		}
	}

	// Recipients are a set: their order means nothing.
	const added = after.emailRecipients.filter((email) => !before.emailRecipients.includes(email));
	const removed = before.emailRecipients.filter((email) => !after.emailRecipients.includes(email));
	if (added.length > 0 || removed.length > 0) {
		changes.emailRecipients = {
			before: [...before.emailRecipients],
			after: [...after.emailRecipients],
			added,
			removed,
		};
	}

	const entries: ScheduleUpdateAuditEntry[] = [];
	if (Object.keys(changes).length > 0) entries.push({ kind: "updated", changes });
	if (before.isActive !== after.isActive)
		entries.push({ kind: after.isActive ? "resumed" : "paused" });
	return entries;
}
