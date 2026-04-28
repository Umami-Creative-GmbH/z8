import { createHash } from "node:crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	importBatch,
	importBatchJob,
	importIssue,
	importJobSecret,
	importRejectedExport,
	importStagedRow,
} from "@/db/schema";
import type { EncryptedImportCredential } from "./credential-secret";
import type {
	ImportBatchStatus,
	ImportDateRange,
	ImportEntityType,
	ImportIssueDraft,
	ImportIssueSeverity,
	ImportJobKind,
	ImportJobStatus,
	ImportProvider,
	ImportRowStatus,
	NormalizedImportRow,
} from "./types";

type ImportRowDecision = "accepted" | "rejected";

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.filter((key) => key !== "hash")
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
			.join(",")}}`;
	}

	return JSON.stringify(value) ?? "undefined";
}

function sourcePayloadHash(row: NormalizedImportRow): string {
	return createHash("sha256").update(stableStringify(row.sourcePayload)).digest("hex");
}

export async function createImportBatch(input: {
	organizationId: string;
	provider: ImportProvider;
	selectedScope: Record<string, unknown>;
	dateRange: ImportDateRange;
	startedBy: string;
}) {
	const [batch] = await db.insert(importBatch).values(input).returning();
	return batch;
}

export async function updateImportBatchStatus(input: {
	batchId: string;
	organizationId: string;
	status: ImportBatchStatus;
	errorMessage?: string | null;
}) {
	const update: { status: ImportBatchStatus; errorMessage?: string | null } = {
		status: input.status,
	};

	if ("errorMessage" in input) update.errorMessage = input.errorMessage;

	await db
		.update(importBatch)
		.set(update)
		.where(
			and(eq(importBatch.id, input.batchId), eq(importBatch.organizationId, input.organizationId)),
		);
}

export async function createImportBatchJob(input: {
	batchId: string;
	organizationId: string;
	kind: ImportJobKind;
	entityType: ImportEntityType;
	partitionKey: string;
}) {
	const [job] = await db.insert(importBatchJob).values(input).onConflictDoNothing().returning();
	if (job) return job;

	return db.query.importBatchJob.findFirst({
		where: and(
			eq(importBatchJob.batchId, input.batchId),
			eq(importBatchJob.organizationId, input.organizationId),
			eq(importBatchJob.kind, input.kind),
			eq(importBatchJob.partitionKey, input.partitionKey),
		),
	});
}

export async function updateImportBatchJob(input: {
	jobId: string;
	organizationId: string;
	status: ImportJobStatus;
	processedRows?: number;
	errorMessage?: string | null;
}) {
	const update: {
		status: ImportJobStatus;
		processedRows?: number;
		errorMessage?: string | null;
		startedAt?: Date;
		completedAt?: Date;
	} = { status: input.status };

	if ("processedRows" in input) update.processedRows = input.processedRows;
	if ("errorMessage" in input) update.errorMessage = input.errorMessage;
	if (input.status === "running") update.startedAt = new Date();
	if (input.status === "completed" || input.status === "failed") update.completedAt = new Date();

	await db
		.update(importBatchJob)
		.set(update)
		.where(
			and(
				eq(importBatchJob.id, input.jobId),
				eq(importBatchJob.organizationId, input.organizationId),
			),
		);
}

export async function saveImportJobSecret(input: {
	batchId: string;
	organizationId: string;
	credential: EncryptedImportCredential;
}) {
	const [secret] = await db
		.insert(importJobSecret)
		.values({
			batchId: input.batchId,
			organizationId: input.organizationId,
			ciphertext: input.credential.ciphertext,
			iv: input.credential.iv,
			authTag: input.credential.authTag,
			expiresAt: input.credential.expiresAt,
		})
		.returning();
	return secret;
}

export async function getImportJobSecret(input: { secretId: string; organizationId: string }) {
	return db.query.importJobSecret.findFirst({
		where: and(
			eq(importJobSecret.id, input.secretId),
			eq(importJobSecret.organizationId, input.organizationId),
		),
	});
}

export async function insertStagedRows(input: {
	batchId: string;
	organizationId: string;
	rows: NormalizedImportRow[];
}) {
	if (input.rows.length === 0) return [];

	return db
		.insert(importStagedRow)
		.values(
			input.rows.map((row) => ({
				batchId: input.batchId,
				organizationId: input.organizationId,
				entityType: row.entityType,
				providerSourceId: row.providerSourceId,
				sourcePayloadHash: sourcePayloadHash(row),
				sourcePayload: row.sourcePayload,
				normalizedPayload: row.normalizedPayload,
				matchTarget: row.matchTarget ?? null,
				rowStatus: row.rowStatus,
				issueSeverity: row.issueSeverity,
			})),
		)
		.onConflictDoNothing()
		.returning();
}

export async function insertImportIssues(input: {
	batchId: string;
	organizationId: string;
	stagedRowId?: string | null;
	issues: ImportIssueDraft[];
}) {
	if (input.issues.length === 0) return [];

	return db
		.insert(importIssue)
		.values(
			input.issues.map((issue) => ({
				batchId: input.batchId,
				organizationId: input.organizationId,
				stagedRowId: input.stagedRowId ?? null,
				issueType: issue.issueType,
				severity: issue.severity,
				clusterKey: issue.clusterKey ?? null,
				message: issue.message,
				details: issue.details,
				detectionRuleVersion: issue.detectionRuleVersion,
			})),
		)
		.returning();
}

export async function getImportReviewSummary(input: { batchId: string; organizationId: string }) {
	const rowBaseWhere = and(
		eq(importStagedRow.batchId, input.batchId),
		eq(importStagedRow.organizationId, input.organizationId),
	);
	const issueBaseWhere = and(
		eq(importIssue.batchId, input.batchId),
		eq(importIssue.organizationId, input.organizationId),
	);

	const [rowCounts] = await db
		.select({
			totalRows: count(),
			acceptedRows: sql<number>`count(*) filter (where ${importStagedRow.rowStatus} = 'accepted')::int`,
			rejectedRows: sql<number>`count(*) filter (where ${importStagedRow.rowStatus} = 'rejected')::int`,
			blockedRows: sql<number>`count(*) filter (where ${importStagedRow.rowStatus} = 'blocked')::int`,
			committedRows: sql<number>`count(*) filter (where ${importStagedRow.rowStatus} = 'committed')::int`,
		})
		.from(importStagedRow)
		.where(rowBaseWhere);
	const [issueCounts] = await db
		.select({ issueCount: count() })
		.from(importIssue)
		.where(issueBaseWhere);

	return {
		totalRows: Number(rowCounts?.totalRows ?? 0),
		acceptedRows: Number(rowCounts?.acceptedRows ?? 0),
		rejectedRows: Number(rowCounts?.rejectedRows ?? 0),
		blockedRows: Number(rowCounts?.blockedRows ?? 0),
		committedRows: Number(rowCounts?.committedRows ?? 0),
		issueCount: Number(issueCounts?.issueCount ?? 0),
	};
}

export async function listImportReviewRows(input: {
	batchId: string;
	organizationId: string;
	status?: ImportRowStatus;
	limit: number;
	offset: number;
}) {
	const conditions = [
		eq(importStagedRow.batchId, input.batchId),
		eq(importStagedRow.organizationId, input.organizationId),
	];

	if (input.status) conditions.push(eq(importStagedRow.rowStatus, input.status));

	return db
		.select()
		.from(importStagedRow)
		.where(and(...conditions))
		.orderBy(asc(importStagedRow.createdAt), asc(importStagedRow.id))
		.limit(input.limit)
		.offset(input.offset);
}

export async function applyImportRowDecision(input: {
	batchId: string;
	organizationId: string;
	rowIds: string[];
	decision: ImportRowDecision;
	reason?: string | null;
	decidedBy: string;
}) {
	const rows = await db
		.select({ id: importStagedRow.id, issueSeverity: importStagedRow.issueSeverity })
		.from(importStagedRow)
		.where(
			and(
				eq(importStagedRow.batchId, input.batchId),
				eq(importStagedRow.organizationId, input.organizationId),
				inArray(importStagedRow.id, input.rowIds),
			),
		);

	const baseUpdate = {
		decisionReason: input.reason ?? null,
		decidedBy: input.decidedBy,
		decidedAt: new Date(),
	};

	async function updateRows(rowIds: string[], rowStatus: ImportRowStatus) {
		if (rowIds.length === 0) return [];
		return db
			.update(importStagedRow)
			.set({ ...baseUpdate, rowStatus })
			.where(
				and(
					eq(importStagedRow.batchId, input.batchId),
					eq(importStagedRow.organizationId, input.organizationId),
					inArray(importStagedRow.id, rowIds),
				),
			)
			.returning({ id: importStagedRow.id });
	}

	if (input.decision === "rejected") {
		const updated = await updateRows(
			rows.map((row) => row.id),
			"rejected",
		);
		return { updatedCount: updated.length };
	}

	const blockingRows = rows
		.filter((row: { issueSeverity: ImportIssueSeverity }) => row.issueSeverity === "blocking")
		.map((row) => row.id);
	const acceptedRows = rows
		.filter((row: { issueSeverity: ImportIssueSeverity }) => row.issueSeverity !== "blocking")
		.map((row) => row.id);
	const [acceptedUpdated, blockedUpdated] = await Promise.all([
		updateRows(acceptedRows, "accepted"),
		updateRows(blockingRows, "blocked"),
	]);

	return { updatedCount: acceptedUpdated.length + blockedUpdated.length };
}

export async function createCommitJobsForAcceptedRows(input: {
	batchId: string;
	organizationId: string;
}) {
	const entityTypes = await db
		.selectDistinct({ entityType: importStagedRow.entityType })
		.from(importStagedRow)
		.where(
			and(
				eq(importStagedRow.batchId, input.batchId),
				eq(importStagedRow.organizationId, input.organizationId),
				eq(importStagedRow.rowStatus, "accepted"),
			),
		)
		.orderBy(asc(importStagedRow.entityType));

	const jobs = [];
	for (const row of entityTypes) {
		const entityType = row.entityType as ImportEntityType;
		const job = await createImportBatchJob({
			batchId: input.batchId,
			organizationId: input.organizationId,
			kind: "commit",
			entityType,
			partitionKey: `commit:${entityType}`,
		});

		if (job) jobs.push(job);
	}

	return jobs;
}

export async function recordRejectedExport(input: {
	batchId: string;
	organizationId: string;
	exportedBy: string;
	rowCount: number;
	fileName: string;
}) {
	const [record] = await db.insert(importRejectedExport).values(input).returning();
	return record;
}
