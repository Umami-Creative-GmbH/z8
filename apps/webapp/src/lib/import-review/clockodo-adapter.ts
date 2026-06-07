import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { clockodoUserMapping } from "@/db/schema";
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
import { decryptImportCredential } from "./credential-secret";
import { classifyTimeWindow, detectMissingMapping } from "./detection";
import { getImportJobSecret, insertImportIssues, insertStagedRows } from "./repository";
import type {
	ImportEntityType,
	ImportIssueDraft,
	ImportScanJobData,
	NormalizedImportRow,
} from "./types";

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

interface ClockodoMapping {
	clockodoUserId: number;
	employeeId: string | null;
	mappingType: string;
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

function isReferenceEntityType(
	entityType: ImportEntityType,
): entityType is ClockodoReferenceEntityType {
	return (
		entityType === "holiday" ||
		entityType === "holiday_quota" ||
		entityType === "surcharge" ||
		entityType === "target_hours"
	);
}

function parseCredentials(raw: string): ClockodoCredentials {
	const parsed = JSON.parse(raw) as unknown;

	if (!isRecord(parsed) || typeof parsed.email !== "string" || typeof parsed.apiKey !== "string") {
		throw new Error("Clockodo import credential is invalid");
	}

	return { email: parsed.email, apiKey: parsed.apiKey };
}

function assertClientMethod<T extends (...args: never[]) => Promise<unknown>>(
	client: ClockodoClient,
	methodName: string,
): T {
	const method = (client as unknown as Record<string, unknown>)[methodName];
	if (typeof method !== "function") {
		throw new Error(`Clockodo client method ${methodName} is not implemented`);
	}

	return method.bind(client) as T;
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
		rowStatus:
			input.rowStatus ??
			(issues.some((issue) => issue.issueType === "unmatched_employee")
				? "needs_mapping"
				: "staged"),
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

function overlapsDateRange(input: {
	startsAt: string;
	endsAt: string;
	rangeStart: DateTime;
	rangeEnd: DateTime;
}): boolean {
	const startsAt = parseDateOnly(input.startsAt);
	const endsAt = parseDateOnly(input.endsAt);
	if (!startsAt || !endsAt) return true;
	return startsAt <= input.rangeEnd && endsAt >= input.rangeStart;
}

function overlapsOpenEndedDateRange(input: {
	startsAt: string;
	endsAt: string | null;
	rangeStart: DateTime;
	rangeEnd: DateTime;
}): boolean {
	const startsAt = parseDateOnly(input.startsAt);
	const endsAt = input.endsAt ? parseDateOnly(input.endsAt) : null;
	if (!startsAt || (input.endsAt && !endsAt)) return true;
	return startsAt <= input.rangeEnd && (!endsAt || endsAt >= input.rangeStart);
}

function isDateWithinRange(input: {
	date: string;
	rangeStart: DateTime;
	rangeEnd: DateTime;
}): boolean {
	const date = parseDateOnly(input.date);
	if (!date) return true;
	return date >= input.rangeStart && date <= input.rangeEnd;
}

function overlapsYearRange(input: {
	yearSince: number;
	yearUntil: number | null;
	rangeYears: number[];
}): boolean {
	const startYear = Math.min(...input.rangeYears);
	const endYear = Math.max(...input.rangeYears);
	return input.yearSince <= endYear && (input.yearUntil ?? input.yearSince) >= startYear;
}

function providerSourceId(entityType: string, id: unknown, fallback: string): string {
	return `clockodo:${entityType}:${id == null || id === "" ? fallback : String(id)}`;
}

function mappedEmployeeId(mapping: ClockodoMapping | undefined): string | null {
	if (!mapping || mapping.mappingType === "skipped") return null;
	return mapping.employeeId ?? null;
}

function selectedProviderUserIds(job: ImportScanJobData): Set<number> | null {
	if (!Array.isArray(job.employeeIds)) return null;

	const ids = job.employeeIds.flatMap((id) => {
		if (!/^\d+$/.test(id)) return [];
		const numericId = Number(id);
		return Number.isSafeInteger(numericId) ? [numericId] : [];
	});
	return new Set(ids);
}

function isSelectedProviderUser(
	providerUserIds: Set<number> | null,
	clockodoUserId: number,
): boolean {
	return providerUserIds === null || providerUserIds.has(clockodoUserId);
}

async function loadUserMappings(input: {
	organizationId: string;
	providerUserIds: number[];
}): Promise<Map<number, ClockodoMapping>> {
	const providerUserIds = [
		...new Set(input.providerUserIds.filter((id) => Number.isSafeInteger(id))),
	];
	if (providerUserIds.length === 0) return new Map();

	const mappings = await db.query.clockodoUserMapping.findMany({
		where: and(
			eq(clockodoUserMapping.organizationId, input.organizationId),
			inArray(clockodoUserMapping.clockodoUserId, providerUserIds),
		),
		columns: {
			clockodoUserId: true,
			employeeId: true,
			mappingType: true,
		},
	});

	return new Map(
		mappings.map((mapping) => [
			mapping.clockodoUserId,
			{
				clockodoUserId: mapping.clockodoUserId,
				employeeId: mapping.employeeId,
				mappingType: mapping.mappingType,
			},
		]),
	);
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

function stageService(service: ClockodoService): {
	row: NormalizedImportRow;
	issues: ImportIssueDraft[];
} {
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

function stageEntry(
	entry: ClockodoEntry,
	mappings: Map<number, ClockodoMapping>,
): { row: NormalizedImportRow; issues: ImportIssueDraft[] } {
	const providerId = providerSourceId("entry", entry.id, `${entry.users_id}:${entry.time_since}`);
	const employeeId = mappedEmployeeId(mappings.get(entry.users_id));
	const suspiciousFlags = classifyTimeWindow({
		startsAt: String(entry.time_since),
		endsAt: entry.time_until ? String(entry.time_until) : null,
	});
	const issues = [
		detectMissingMapping({ entityType: "work_period", providerSourceId: providerId, employeeId }),
		suspiciousFlags.length > 0
			? createSuspiciousIssue({
					entityType: "work_period",
					providerSourceId: providerId,
					suspiciousFlags,
				})
			: null,
	].filter((issue): issue is ImportIssueDraft => issue !== null);

	return {
		row: row({
			entityType: "work_period",
			providerSourceId: providerId,
			sourcePayload: entry as unknown as Record<string, unknown>,
			normalizedPayload: {
				employeeId,
				startsAt: entry.time_since,
				endsAt: entry.time_until ?? null,
				serviceId: null,
				providerEmployeeId: entry.users_id,
				providerServiceId: entry.services_id ?? null,
				durationSeconds: entry.duration ?? null,
				suspiciousFlags,
			},
			matchTarget: {
				providerEmployeeId: entry.users_id,
				providerServiceId: entry.services_id ?? null,
			},
			issues,
		}),
		issues,
	};
}

function stageAbsence(
	absence: ClockodoAbsence,
	mappings: Map<number, ClockodoMapping>,
): { row: NormalizedImportRow; issues: ImportIssueDraft[] } {
	const providerId = providerSourceId(
		"absence",
		absence.id,
		`${absence.users_id}:${absence.date_since}`,
	);
	const employeeId = mappedEmployeeId(mappings.get(absence.users_id));
	const suspiciousFlags = classifyAbsenceRange({
		startsAt: absence.date_since,
		endsAt: absence.date_until,
	});
	const issues = [
		detectMissingMapping({ entityType: "absence", providerSourceId: providerId, employeeId }),
		suspiciousFlags.length > 0
			? createSuspiciousIssue({
					entityType: "absence",
					providerSourceId: providerId,
					suspiciousFlags,
				})
			: null,
	].filter((issue): issue is ImportIssueDraft => issue !== null);

	return {
		row: row({
			entityType: "absence",
			providerSourceId: providerId,
			sourcePayload: absence as unknown as Record<string, unknown>,
			normalizedPayload: {
				employeeId,
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
	item:
		| ClockodoHolidayQuota
		| ClockodoNonBusinessDay
		| ClockodoSurcharge
		| ClockodoTargetHours
		| Record<string, unknown>;
	index: number;
	dateRange: ImportScanJobData["dateRange"];
}): { row: NormalizedImportRow; issues: ImportIssueDraft[] } {
	const payload = input.item as Record<string, unknown>;
	const id = payload.id;

	return {
		row: row({
			entityType: input.entityType,
			providerSourceId: providerSourceId(
				input.providerKind,
				id,
				`${input.dateRange.startDate}:${input.dateRange.endDate}:${input.index}`,
			),
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

async function stageReferenceRows(input: {
	client: ClockodoClient;
	entityType: ClockodoReferenceEntityType;
	dateRange: ImportScanJobData["dateRange"];
	rangeStart: DateTime;
	rangeEnd: DateTime;
	years: number[];
}): Promise<Array<{ row: NormalizedImportRow; issues: ImportIssueDraft[] }>> {
	if (input.entityType === "target_hours") {
		const getTargetHours = assertClientMethod<() => Promise<ClockodoTargetHours[]>>(
			input.client,
			"getTargetHours",
		);
		return (await getTargetHours())
			.filter((item) =>
				overlapsOpenEndedDateRange({
					startsAt: item.date_since,
					endsAt: item.date_until,
					rangeStart: input.rangeStart,
					rangeEnd: input.rangeEnd,
				}),
			)
			.map((item, index) =>
				stageReferenceRow({
					entityType: "target_hours",
					providerKind: "target_hours",
					item,
					index,
					dateRange: input.dateRange,
				}),
			);
	}

	if (input.entityType === "holiday_quota") {
		const getHolidayQuotas = assertClientMethod<() => Promise<ClockodoHolidayQuota[]>>(
			input.client,
			"getHolidayQuotas",
		);
		return (await getHolidayQuotas())
			.filter((item) =>
				overlapsYearRange({
					yearSince: item.year_since,
					yearUntil: item.year_until,
					rangeYears: input.years,
				}),
			)
			.map((item, index) =>
				stageReferenceRow({
					entityType: "holiday_quota",
					providerKind: "holiday_quota",
					item,
					index,
					dateRange: input.dateRange,
				}),
			);
	}

	if (input.entityType === "holiday") {
		const getNonBusinessDays = assertClientMethod<
			(year: number) => Promise<ClockodoNonBusinessDay[]>
		>(input.client, "getNonBusinessDays");
		const holidays = (
			await Promise.all(input.years.map((year) => getNonBusinessDays(year)))
		).flat();
		return holidays
			.filter((item) =>
				isDateWithinRange({
					date: item.date,
					rangeStart: input.rangeStart,
					rangeEnd: input.rangeEnd,
				}),
			)
			.map((item, index) =>
				stageReferenceRow({
					entityType: "holiday",
					providerKind: "holiday",
					item,
					index,
					dateRange: input.dateRange,
				}),
			);
	}

	const getSurcharges = assertClientMethod<() => Promise<ClockodoSurcharge[]>>(
		input.client,
		"getSurcharges",
	);
	return (await getSurcharges()).map((item, index) =>
		stageReferenceRow({
			entityType: "surcharge",
			providerKind: "surcharge",
			item,
			index,
			dateRange: input.dateRange,
		}),
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
	const scopedProviderUserIds = selectedProviderUserIds(job);
	let staged: Array<{ row: NormalizedImportRow; issues: ImportIssueDraft[] }>;

	if (job.entityType === "employee") {
		const getUsers = assertClientMethod<() => Promise<ClockodoUser[]>>(client, "getUsers");
		staged = (await getUsers()).flatMap((user) =>
			isSelectedProviderUser(scopedProviderUserIds, user.id) ? [stageUser(user)] : [],
		);
	} else if (job.entityType === "team") {
		const getTeams = assertClientMethod<() => Promise<ClockodoTeam[]>>(client, "getTeams");
		staged = (await getTeams()).map(stageTeam);
	} else if (job.entityType === "service" || job.entityType === "work_category") {
		const getServices = assertClientMethod<() => Promise<ClockodoService[]>>(client, "getServices");
		staged = (await getServices()).map(stageService);
	} else if (job.entityType === "work_period") {
		const getEntries = assertClientMethod<
			(timeSince: string, timeUntil: string) => Promise<ClockodoEntry[]>
		>(client, "getEntries");
		const entries = (await getEntries(timeSince, timeUntil)).filter((entry) =>
			isSelectedProviderUser(scopedProviderUserIds, entry.users_id),
		);
		const mappings = await loadUserMappings({
			organizationId: job.organizationId,
			providerUserIds: entries.map((entry) => entry.users_id),
		});
		staged = entries.map((entry) => stageEntry(entry, mappings));
	} else if (job.entityType === "absence") {
		const getAbsences = assertClientMethod<(year: number) => Promise<ClockodoAbsence[]>>(
			client,
			"getAbsences",
		);
		const absences = (
			await Promise.all(yearsInRange(start, end).map((year) => getAbsences(year)))
		).flat();
		const filteredAbsences = absences.filter(
			(absence) =>
				isSelectedProviderUser(scopedProviderUserIds, absence.users_id) &&
				overlapsDateRange({
					startsAt: absence.date_since,
					endsAt: absence.date_until,
					rangeStart: start,
					rangeEnd: end,
				}),
		);
		const mappings = await loadUserMappings({
			organizationId: job.organizationId,
			providerUserIds: filteredAbsences.map((absence) => absence.users_id),
		});
		staged = filteredAbsences.map((absence) => stageAbsence(absence, mappings));
	} else if (isReferenceEntityType(job.entityType)) {
		staged = await stageReferenceRows({
			client,
			entityType: job.entityType,
			dateRange: job.dateRange,
			rangeStart: start,
			rangeEnd: end,
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
