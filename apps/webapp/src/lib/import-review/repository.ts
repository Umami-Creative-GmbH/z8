import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
	ImportJobKind,
	ImportJobStatus,
	ImportProvider,
	NormalizedImportRow,
} from "./types";

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
		.where(and(eq(importBatch.id, input.batchId), eq(importBatch.organizationId, input.organizationId)));
}

export async function createImportBatchJob(input: {
	batchId: string;
	organizationId: string;
	kind: ImportJobKind;
	entityType: ImportEntityType;
	partitionKey: string;
}) {
	const [job] = await db
		.insert(importBatchJob)
		.values(input)
		.onConflictDoNothing()
		.returning();
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
		.where(and(eq(importBatchJob.id, input.jobId), eq(importBatchJob.organizationId, input.organizationId)));
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
		where: and(eq(importJobSecret.id, input.secretId), eq(importJobSecret.organizationId, input.organizationId)),
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
