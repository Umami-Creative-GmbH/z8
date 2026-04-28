import { env } from "@/env";
import { ClockinClient } from "@/lib/clockin/client";
import type { ClockinAbsence, ClockinWorkday } from "@/lib/clockin/types";
import { DateTime } from "luxon";
import { decryptImportCredential } from "./credential-secret";
import { classifyTimeWindow, detectMissingMapping } from "./detection";
import { getImportJobSecret, insertImportIssues, insertStagedRows } from "./repository";
import type { ImportEmployeeMapping, ImportScanJobData } from "./types";
import type { ImportIssueDraft, NormalizedImportRow } from "./types";

const DETECTION_RULE_VERSION = "import-review-v1";

export interface ClockinScanResult {
	stagedRows: number;
	issues: number;
}

function toClockinEmployeeIds(employeeIds: string[]): number[] {
	const ids = new Set<number>();

	for (const employeeId of employeeIds) {
		const trimmed = employeeId.trim();
		if (!/^\d+$/.test(trimmed)) continue;

		const numericId = Number(trimmed);
		if (Number.isSafeInteger(numericId)) ids.add(numericId);
	}

	return [...ids];
}

function sourceId(entityType: "absence" | "workday", id: unknown): string {
	return `clockin:${entityType}:${String(id)}`;
}

function employeeMappingByProviderId(mappings: ImportEmployeeMapping[] | undefined) {
	const mapped = new Map<string, ImportEmployeeMapping>();
	for (const mapping of mappings ?? []) {
		mapped.set(mapping.providerEmployeeId, mapping);
	}
	return mapped;
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

function issueSeverityFor(issues: ImportIssueDraft[]) {
	if (issues.some((issue) => issue.severity === "blocking")) return "blocking";
	if (issues.some((issue) => issue.severity === "warning")) return "warning";
	if (issues.some((issue) => issue.severity === "info")) return "info";
	return "none";
}

function classifyAbsenceRange(input: { startsAt: string; endsAt: string }): string[] {
	const flags: string[] = [];
	const start = DateTime.fromISO(input.startsAt, { zone: "utc" });
	const end = DateTime.fromISO(input.endsAt, { zone: "utc" });

	if (!start.isValid) flags.push("invalid_start");
	if (!end.isValid) flags.push("invalid_end");
	if (start.isValid && end.isValid && end < start) flags.push("non_positive_range");

	return flags;
}

function stagedWorkday(
	workday: ClockinWorkday & { id?: unknown },
	mappings: Map<string, ImportEmployeeMapping>,
): {
	row: NormalizedImportRow;
	issues: ImportIssueDraft[];
} {
	const providerSourceId = sourceId("workday", workday.id ?? `${workday.employee_id}:${workday.date}`);
	const mapping = mappings.get(String(workday.employee_id));
	const employeeId = mapping?.employeeId ?? null;
	const suspiciousFlags = workday.starts_at
		? classifyTimeWindow({ startsAt: workday.starts_at, endsAt: workday.ends_at })
		: ["invalid_start"];
	const issues = [
		detectMissingMapping({ entityType: "work_period", providerSourceId, employeeId }),
		suspiciousFlags.length > 0
			? createSuspiciousIssue({ entityType: "work_period", providerSourceId, suspiciousFlags })
			: null,
	].filter((issue): issue is ImportIssueDraft => issue !== null);

	return {
		row: {
			entityType: "work_period",
			providerSourceId,
			sourcePayload: workday as unknown as Record<string, unknown>,
			normalizedPayload: {
				employeeId,
				startsAt: workday.starts_at,
				endsAt: workday.ends_at,
				suspiciousFlags,
			},
			matchTarget: {
				providerEmployeeId: workday.employee_id,
				employeeId,
				userId: mapping?.userId ?? null,
			},
			rowStatus: issues.some((issue) => issue.issueType === "unmatched_employee")
				? "needs_mapping"
				: "accepted",
			issueSeverity: issueSeverityFor(issues),
		},
		issues,
	};
}

function stagedAbsence(
	absence: ClockinAbsence,
	mappings: Map<string, ImportEmployeeMapping>,
): {
	row: NormalizedImportRow;
	issues: ImportIssueDraft[];
} {
	const providerSourceId = sourceId("absence", absence.id);
	const mapping = mappings.get(String(absence.employee_id));
	const employeeId = mapping?.employeeId ?? null;
	const suspiciousFlags = classifyAbsenceRange({ startsAt: absence.starts_at, endsAt: absence.ends_at });
	const issues = [
		detectMissingMapping({ entityType: "absence", providerSourceId, employeeId }),
		suspiciousFlags.length > 0
			? createSuspiciousIssue({ entityType: "absence", providerSourceId, suspiciousFlags })
			: null,
	].filter((issue): issue is ImportIssueDraft => issue !== null);

	return {
		row: {
			entityType: "absence",
			providerSourceId,
			sourcePayload: absence as unknown as Record<string, unknown>,
			normalizedPayload: {
				employeeId,
				startsAt: absence.starts_at,
				endsAt: absence.ends_at,
				suspiciousFlags,
				absenceCategoryName: absence.absencecategory_name,
				approval: absence.approval,
				duration: absence.duration,
				note: absence.note,
			},
			matchTarget: {
				providerEmployeeId: absence.employee_id,
				employeeId,
				userId: mapping?.userId ?? null,
			},
			rowStatus: issues.some((issue) => issue.issueType === "unmatched_employee")
				? "needs_mapping"
				: "accepted",
			issueSeverity: issueSeverityFor(issues),
		},
		issues,
	};
}

async function loadClient(job: ImportScanJobData): Promise<ClockinClient> {
	const secret = await getImportJobSecret({
		secretId: job.secretId,
		organizationId: job.organizationId,
	});

	if (!secret) throw new Error("Import credential was not found");

	const token = decryptImportCredential(
		{
			ciphertext: secret.ciphertext,
			iv: secret.iv,
			authTag: secret.authTag,
			expiresAt: secret.expiresAt,
		},
		env.BETTER_AUTH_SECRET,
	);

	return new ClockinClient(token);
}

export async function scanClockinImportPartition(job: ImportScanJobData): Promise<ClockinScanResult> {
	if (job.entityType !== "work_period" && job.entityType !== "absence") {
		throw new Error(`Unsupported Clockin import review entity type: ${job.entityType}`);
	}

	const employeeIds = toClockinEmployeeIds(job.employeeIds);
	if (employeeIds.length === 0) return { stagedRows: 0, issues: 0 };

	const client = await loadClient(job);
	const employeeMappings = employeeMappingByProviderId(job.employeeMappings);
	const staged =
		job.entityType === "work_period"
			? (await client.searchWorkdays({
					employeeIds,
					startDate: job.dateRange.startDate,
					endDate: job.dateRange.endDate,
				})).map((workday) => stagedWorkday(workday, employeeMappings))
			: (await client.searchAbsences({
					employeeIds,
					startDate: job.dateRange.startDate,
					endDate: job.dateRange.endDate,
				})).map((absence) => stagedAbsence(absence, employeeMappings));

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
