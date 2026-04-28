import { env } from "@/env";
import { ClockodoClient } from "@/lib/clockodo/client";
import type {
	ClockodoAbsence,
	ClockodoEntry,
	ClockodoHolidayQuota,
	ClockodoNonBusinessDay,
	ClockodoService,
	ClockodoSurcharge,
	ClockodoTargetHours,
	ClockodoTeam,
	ClockodoUser,
} from "@/lib/clockodo/types";
import { DateTime } from "luxon";
import { decryptImportCredential } from "./credential-secret";
import { classifyTimeWindow, detectMissingMapping } from "./detection";
import { getImportJobSecret, insertImportIssues, insertStagedRows } from "./repository";
import type { ImportEntityType, ImportIssueDraft, ImportScanJobData, NormalizedImportRow } from "./types";

const DETECTION_RULE_VERSION = "import-review-v1";
const SUPPORTED_ENTITY_TYPES = new Set<ImportEntityType>([
	"employee",
	"team",
	"service",
	"work_category",
	"work_period",
	"absence",
	"target_hours",
	"holiday_quota",
	"holiday",
	"surcharge",
]);
type ClockodoReferenceEntityType = "holiday" | "holiday_quota" | "surcharge" | "target_hours";

interface ClockodoCredentials {
	email: string;
	apiKey: string;
}

function parseDateOnly(value: string): DateTime | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const date = DateTime.fromISO(value, { zone: "utc" });
	return date.isValid ? date : null;
}

function validatedDateRange(job: ImportScanJobData) {
	const start = parseDateOnly(job.dateRange.startDate);
	const end = parseDateOnly(job.dateRange.endDate);

	if (!start || !end || end < start) {
		throw new Error(`Invalid Clockodo import review date range for ${job.entityType}`);
	}

	return {
		start,
		end,
		timeSince: `${job.dateRange.startDate}T00:00:00Z`,
		timeUntil: `${job.dateRange.endDate}T23:59:59Z`,
	};
}

function yearsInRange(start: DateTime, end: DateTime): number[] {
	const years: number[] = [];
	for (let year = start.year; year <= end.year; year++) years.push(year);
	return years;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReferenceEntityType(entityType: ImportEntityType): entityType is ClockodoReferenceEntityType {
	return entityType === "holiday" || entityType === "holiday_quota" || entityType === "surcharge" || entityType === "target_hours";
}

function parseCredentials(raw: string): ClockodoCredentials {
	const parsed = JSON.parse(raw) as unknown;

	if (!isRecord(parsed) || typeof parsed.email !== "string" || typeof parsed.apiKey !== "string") {
		throw new Error("Clockodo import credential is invalid");
	}

	return { email: parsed.email, apiKey: parsed.apiKey };
}

async function loadClient(job: ImportScanJobData): Promise<ClockodoClient> {
	const secret = await getImportJobSecret({
		secretId: job.secretId,
		organizationId: job.organizationId,
	});

	if (!secret) throw new Error("Import credential was not found");

	const credentials = parseCredentials(
		decryptImportCredential(
			{
				ciphertext: secret.ciphertext,
				iv: secret.iv,
				authTag: secret.authTag,
				expiresAt: secret.expiresAt,
			},
			env.BETTER_AUTH_SECRET,
		),
	);

	return new ClockodoClient(credentials.email, credentials.apiKey);
}

function row(input: {
	entityType: NormalizedImportRow["entityType"];
	providerSourceId: string;
	sourcePayload: Record<string, unknown>;
	normalizedPayload: Record<string, unknown>;
	matchTarget?: Record<string, unknown> | null;
	issues?: ImportIssueDraft[];
	rowStatus?: NormalizedImportRow["rowStatus"];
}): NormalizedImportRow {
	const issues = input.issues ?? [];

	return {
		entityType: input.entityType,
		providerSourceId: input.providerSourceId,
		sourcePayload: input.sourcePayload,
		normalizedPayload: input.normalizedPayload,
		matchTarget: input.matchTarget ?? null,
		rowStatus: input.rowStatus ?? (issues.some((issue) => issue.issueType === "unmatched_employee") ? "needs_mapping" : "staged"),
		issueSeverity: issueSeverityFor(issues),
	};
}

function issueSeverityFor(issues: ImportIssueDraft[]) {
	if (issues.some((issue) => issue.severity === "blocking")) return "blocking";
	if (issues.some((issue) => issue.severity === "warning")) return "warning";
	if (issues.some((issue) => issue.severity === "info")) return "info";
	return "none";
}

function createSuspiciousIssue(input: {
	entityType: "absence" | "work_period";
	providerSourceId: string;
	suspiciousFlags: string[];
}): ImportIssueDraft {
	return {
		issueType: "suspicious_gap",
		severity: "warning",
		clusterKey: `suspicious_gap:${input.entityType}:${input.providerSourceId}`,
		message: `Suspicious ${input.entityType} time window in ${input.providerSourceId}.`,
		details: input,
		detectionRuleVersion: DETECTION_RULE_VERSION,
	};
}

function classifyAbsenceRange(input: { startsAt: string; endsAt: string }): string[] {
	const flags: string[] = [];
	const start = parseDateOnly(input.startsAt);
	const end = parseDateOnly(input.endsAt);

	if (!start) flags.push("invalid_start");
	if (!end) flags.push("invalid_end");
	if (start && end && end < start) flags.push("non_positive_range");

	return flags;
}

function overlapsDateRange(input: { startsAt: string; endsAt: string; rangeStart: DateTime; rangeEnd: DateTime }): boolean {
	const startsAt = parseDateOnly(input.startsAt);
	const endsAt = parseDateOnly(input.endsAt);
	if (!startsAt || !endsAt) return true;
	return startsAt <= input.rangeEnd && endsAt >= input.rangeStart;
}

function providerSourceId(entityType: string, id: unknown, fallback: string): string {
	return `clockodo:${entityType}:${id == null || id === "" ? fallback : String(id)}`;
}

function stageUser(user: ClockodoUser): { row: NormalizedImportRow; issues: ImportIssueDraft[] } {
	return {
		row: row({
			entityType: "employee",
			providerSourceId: providerSourceId("user", user.id, user.email),
			sourcePayload: user as unknown as Record<string, unknown>,
			normalizedPayload: {
				clockodoUserId: user.id,
				name: user.name,
				email: user.email,
				number: user.number ?? null,
				active: user.active,
				teamId: user.teams_id ?? null,
			},
		}),
		issues: [],
	};
}

function stageTeam(team: ClockodoTeam): { row: NormalizedImportRow; issues: ImportIssueDraft[] } {
	return {
		row: row({
			entityType: "team",
			providerSourceId: providerSourceId("team", team.id, team.name),
			sourcePayload: team as unknown as Record<string, unknown>,
			normalizedPayload: {
				clockodoTeamId: team.id,
				name: team.name,
				leaderUserId: team.leader ?? null,
			},
		}),
		issues: [],
	};
}

function stageService(service: ClockodoService): { row: NormalizedImportRow; issues: ImportIssueDraft[] } {
	return {
		row: row({
			entityType: "work_category",
			providerSourceId: providerSourceId("service", service.id, service.name),
			sourcePayload: service as unknown as Record<string, unknown>,
			normalizedPayload: {
				clockodoServiceId: service.id,
				name: service.name,
				number: service.number ?? null,
				active: service.active,
				note: service.note ?? null,
			},
		}),
		issues: [],
	};
}

function stageEntry(entry: ClockodoEntry): { row: NormalizedImportRow; issues: ImportIssueDraft[] } {
	const providerId = providerSourceId("entry", entry.id, `${entry.users_id}:${entry.time_since}`);
	const suspiciousFlags = classifyTimeWindow({
		startsAt: String(entry.time_since),
		endsAt: entry.time_until ? String(entry.time_until) : null,
	});
	const issues = [
		detectMissingMapping({ entityType: "work_period", providerSourceId: providerId, employeeId: null }),
		suspiciousFlags.length > 0
			? createSuspiciousIssue({ entityType: "work_period", providerSourceId: providerId, suspiciousFlags })
			: null,
	].filter((issue): issue is ImportIssueDraft => issue !== null);

	return {
		row: row({
			entityType: "work_period",
			providerSourceId: providerId,
			sourcePayload: entry as unknown as Record<string, unknown>,
			normalizedPayload: {
				employeeId: null,
				startsAt: entry.time_since,
				endsAt: entry.time_until ?? null,
				serviceId: null,
				providerEmployeeId: entry.users_id,
				providerServiceId: entry.services_id ?? null,
				durationSeconds: entry.duration ?? null,
				suspiciousFlags,
			},
			matchTarget: { providerEmployeeId: entry.users_id, providerServiceId: entry.services_id ?? null },
			issues,
		}),
		issues,
	};
}

function stageAbsence(absence: ClockodoAbsence): { row: NormalizedImportRow; issues: ImportIssueDraft[] } {
	const providerId = providerSourceId("absence", absence.id, `${absence.users_id}:${absence.date_since}`);
	const suspiciousFlags = classifyAbsenceRange({ startsAt: absence.date_since, endsAt: absence.date_until });
	const issues = [
		detectMissingMapping({ entityType: "absence", providerSourceId: providerId, employeeId: null }),
		suspiciousFlags.length > 0
			? createSuspiciousIssue({ entityType: "absence", providerSourceId: providerId, suspiciousFlags })
			: null,
	].filter((issue): issue is ImportIssueDraft => issue !== null);

	return {
		row: row({
			entityType: "absence",
			providerSourceId: providerId,
			sourcePayload: absence as unknown as Record<string, unknown>,
			normalizedPayload: {
				employeeId: null,
				startsAt: absence.date_since,
				endsAt: absence.date_until,
				absenceCategoryId: absence.type,
				status: absence.status,
				note: absence.note ?? null,
				countDays: absence.count_days ?? null,
				countHours: absence.count_hours ?? null,
				providerEmployeeId: absence.users_id,
				suspiciousFlags,
			},
			matchTarget: { providerEmployeeId: absence.users_id, providerAbsenceType: absence.type },
			issues,
		}),
		issues,
	};
}

function stageReferenceRow(input: {
	entityType: ClockodoReferenceEntityType;
	providerKind: string;
	item: ClockodoHolidayQuota | ClockodoNonBusinessDay | ClockodoSurcharge | ClockodoTargetHours | Record<string, unknown>;
	index: number;
	dateRange: ImportScanJobData["dateRange"];
}): { row: NormalizedImportRow; issues: ImportIssueDraft[] } {
	const payload = input.item as Record<string, unknown>;
	const id = payload.id;

	return {
		row: row({
			entityType: input.entityType,
			providerSourceId: providerSourceId(input.providerKind, id, `${input.dateRange.startDate}:${input.dateRange.endDate}:${input.index}`),
			sourcePayload: payload,
			normalizedPayload: {
				...payload,
				stagedAsReferenceData: true,
				dateRange: input.dateRange,
			},
		}),
		issues: [],
	};
}

function placeholderReferenceRow(
	entityType: ClockodoReferenceEntityType,
	dateRange: ImportScanJobData["dateRange"],
): { row: NormalizedImportRow; issues: ImportIssueDraft[] } {
	return stageReferenceRow({
		entityType,
		providerKind: entityType,
		item: { placeholder: true, reason: "Clockodo client method unavailable" },
		index: 0,
		dateRange,
	});
}

async function stageReferenceRows(input: {
	client: ClockodoClient;
	entityType: ClockodoReferenceEntityType;
	dateRange: ImportScanJobData["dateRange"];
	years: number[];
}): Promise<Array<{ row: NormalizedImportRow; issues: ImportIssueDraft[] }>> {
	if (input.entityType === "target_hours") {
		if (typeof input.client.getTargetHours !== "function") return [placeholderReferenceRow("target_hours", input.dateRange)];
		return (await input.client.getTargetHours()).map((item, index) =>
			stageReferenceRow({ entityType: "target_hours", providerKind: "target_hours", item, index, dateRange: input.dateRange }),
		);
	}

	if (input.entityType === "holiday_quota") {
		if (typeof input.client.getHolidayQuotas !== "function") return [placeholderReferenceRow("holiday_quota", input.dateRange)];
		return (await input.client.getHolidayQuotas()).map((item, index) =>
			stageReferenceRow({ entityType: "holiday_quota", providerKind: "holiday_quota", item, index, dateRange: input.dateRange }),
		);
	}

	if (input.entityType === "holiday") {
		if (typeof input.client.getNonBusinessDays !== "function") return [placeholderReferenceRow("holiday", input.dateRange)];
		const holidays = (
			await Promise.all(input.years.map((year) => input.client.getNonBusinessDays(year)))
		).flat();
		return holidays.map((item, index) =>
			stageReferenceRow({ entityType: "holiday", providerKind: "holiday", item, index, dateRange: input.dateRange }),
		);
	}

	if (typeof input.client.getSurcharges !== "function") return [placeholderReferenceRow("surcharge", input.dateRange)];
	return (await input.client.getSurcharges()).map((item, index) =>
		stageReferenceRow({ entityType: "surcharge", providerKind: "surcharge", item, index, dateRange: input.dateRange }),
	);
}

export async function scanClockodoImportPartition(
	job: ImportScanJobData,
): Promise<{ stagedRows: number; issues: number }> {
	if (!SUPPORTED_ENTITY_TYPES.has(job.entityType)) {
		throw new Error(`Unsupported Clockodo import review entity type: ${job.entityType}`);
	}

	const { start, end, timeSince, timeUntil } = validatedDateRange(job);
	const client = await loadClient(job);
	let staged: Array<{ row: NormalizedImportRow; issues: ImportIssueDraft[] }>;

	if (job.entityType === "employee") {
		staged = (await client.getUsers()).map(stageUser);
	} else if (job.entityType === "team") {
		staged = (await client.getTeams()).map(stageTeam);
	} else if (job.entityType === "service" || job.entityType === "work_category") {
		staged = (await client.getServices()).map(stageService);
	} else if (job.entityType === "work_period") {
		staged = (await client.getEntries(timeSince, timeUntil)).map(stageEntry);
	} else if (job.entityType === "absence") {
		const absences = (await Promise.all(yearsInRange(start, end).map((year) => client.getAbsences(year)))).flat();
		staged = absences
			.filter((absence) =>
				overlapsDateRange({
					startsAt: absence.date_since,
					endsAt: absence.date_until,
					rangeStart: start,
					rangeEnd: end,
				}),
			)
			.map(stageAbsence);
	} else if (isReferenceEntityType(job.entityType)) {
		staged = await stageReferenceRows({
			client,
			entityType: job.entityType,
			dateRange: job.dateRange,
			years: yearsInRange(start, end),
		});
	} else {
		throw new Error(`Unsupported Clockodo import review entity type: ${job.entityType}`);
	}

	const inserted = await insertStagedRows({
		batchId: job.batchId,
		organizationId: job.organizationId,
		rows: staged.map(({ row }) => row),
	});
	const issues = staged.flatMap((entry) => entry.issues);

	await insertImportIssues({
		batchId: job.batchId,
		organizationId: job.organizationId,
		issues,
	});

	return { stagedRows: inserted.length, issues: issues.length };
}
