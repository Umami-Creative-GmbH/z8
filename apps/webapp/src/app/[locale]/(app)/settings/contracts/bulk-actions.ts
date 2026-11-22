"use server";

import { z } from "zod";
import {
	commitCsvImportBatch,
	customWorkDaysSchema,
	getContractChangeBatch,
	listContractChangeBatches,
	previewBulkContractAction,
	previewCsvContractImport,
	previewCsvLeavingDateImport,
	submitBulkContractAction,
} from "@/lib/contracts";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";

const uuidSchema = z.uuid("Invalid identifier");
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

const workModelSchema = z.enum(["onsite", "hybrid", "remote", "flexible"]);
const presenceOverrideSchema = z.enum(["inherit", "exempt", "require_onsite"]);
const balanceModeSchema = z.enum(["tracked", "trust_based"]);
const scheduleModeSchema = z.enum(["inherit", "policy", "hours_only", "custom_days"]);
const scheduleSourceSchema = z.enum(["policy", "published_shifts", "on_call"]);
const contractTypeSchema = z.enum(["fixed", "hourly"]);
const employmentProfileSchema = z.enum([
	"regular",
	"minijob",
	"short_term",
	"working_student",
	"apprentice",
]);
const arbzgScopeSchema = z.enum(["standard", "executive_exempt"]);
const onCallHoursKindSchema = z.enum(["exact", "minimum", "maximum", "unspecified"]);
const operationalDivergenceFieldSchema = z.enum([
	"workPolicy",
	"weeklyContractMinutes",
	"scheduleMode",
	"workModel",
	"presenceOverride",
	"balanceMode",
	"scheduleSource",
]);
const batchOperationKindSchema = z.enum([
	"bulk_template_apply",
	"bulk_adopt_default",
	"bulk_terms_update",
	"csv_contract_import",
	"csv_departure_import",
]);
const batchStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"completed_with_errors",
	"failed",
	"canceled",
]);
const batchItemStatusSchema = z.enum(["pending", "running", "completed", "skipped", "failed"]);

const bulkTargetSchema = z.strictObject({
	employeeIds: z.array(uuidSchema).max(20_000).optional(),
	teamId: uuidSchema.nullable().optional(),
	contractType: contractTypeSchema.optional(),
	onlyLegacyTerms: z.boolean().optional(),
});

const bulkChangesSchema = z.strictObject({
	workPolicyId: uuidSchema.nullable().optional(),
	clearPersonalPolicyPin: z.boolean().optional(),
	weeklyContractMinutes: z.number().int().min(0).max(10080).nullable().optional(),
	scheduleMode: scheduleModeSchema.nullable().optional(),
	customDays: customWorkDaysSchema.nullable().optional(),
	workModel: workModelSchema.nullable().optional(),
	presenceOverride: presenceOverrideSchema.nullable().optional(),
	balanceMode: balanceModeSchema.nullable().optional(),
	scheduleSource: scheduleSourceSchema.nullable().optional(),
	contractType: contractTypeSchema.optional(),
	hourlyRate: z.number().min(0).nullable().optional(),
	currency: z.string().min(3).max(10).optional(),
	employmentProfile: employmentProfileSchema.optional(),
	arbzgScope: arbzgScopeSchema.optional(),
	onCallHoursKind: onCallHoursKindSchema.nullable().optional(),
	onCallWeeklyMinutes: z.number().int().min(1).max(10080).nullable().optional(),
	onCallDailyMinutes: z.number().int().min(1).max(1440).nullable().optional(),
	changeReason: z.string().max(500).nullable().optional(),
});

const bulkActionVariantSchemas = [
	z.strictObject({
		actionKind: z.literal("apply_template_version"),
		templateVersionId: uuidSchema,
		effectiveFromDate: isoDateSchema,
		overwritePersonalDivergences: z.boolean().optional(),
		changeReason: z.string().max(500).nullable().optional(),
		target: bulkTargetSchema,
		sampleLimit: z.number().int().min(0).max(500).optional(),
	}),
	z.strictObject({
		actionKind: z.literal("adopt_default"),
		effectiveFromDate: isoDateSchema,
		keepDivergenceFields: z.array(operationalDivergenceFieldSchema).optional(),
		changeReason: z.string().max(500).nullable().optional(),
		target: bulkTargetSchema,
		sampleLimit: z.number().int().min(0).max(500).optional(),
	}),
	z.strictObject({
		actionKind: z.literal("bulk_operational_update"),
		effectiveFromDate: isoDateSchema,
		overwritePersonalDivergences: z.boolean().optional(),
		changes: bulkChangesSchema,
		changeReason: z.string().max(500).nullable().optional(),
		target: bulkTargetSchema,
		sampleLimit: z.number().int().min(0).max(500).optional(),
	}),
] as const;

const previewBulkContractActionSchema = z.discriminatedUnion("actionKind", [
	bulkActionVariantSchemas[0],
	bulkActionVariantSchemas[1],
	bulkActionVariantSchemas[2],
]);

const submitBulkContractActionSchema = z.discriminatedUnion("actionKind", [
	bulkActionVariantSchemas[0].extend({
		requestId: uuidSchema.optional(),
		confirmationFingerprint: z.string().min(64).max(64),
	}),
	bulkActionVariantSchemas[1].extend({
		requestId: uuidSchema.optional(),
		confirmationFingerprint: z.string().min(64).max(64),
	}),
	bulkActionVariantSchemas[2].extend({
		requestId: uuidSchema.optional(),
		confirmationFingerprint: z.string().min(64).max(64),
	}),
]);

// ============================================
// BULK CONTRACT OPERATIONS (#1928)
// ============================================

export const previewBulkContractActionAction = organizationAction(
	{
		name: "contracts.bulk.preview",
		requires: "orgAdmin",
		schema: previewBulkContractActionSchema,
	},
	({ organizationId, input }) =>
		storeStep("contracts.bulk.preview", (db) =>
			previewBulkContractAction(db, {
				organizationId,
				...input,
			}),
		),
);

export const submitBulkContractActionAction = organizationAction(
	{
		name: "contracts.bulk.submit",
		requires: "orgAdmin",
		schema: submitBulkContractActionSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.bulk.submit", (db) =>
			submitBulkContractAction(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
			}),
		),
);

export const listContractChangeBatchesAction = organizationAction(
	{
		name: "contracts.bulk.listBatches",
		requires: "orgAdmin",
		schema: z
			.strictObject({
				operationKind: batchOperationKindSchema.optional(),
				status: batchStatusSchema.optional(),
				limit: z.number().int().min(1).max(100).optional(),
				offset: z.number().int().min(0).optional(),
			})
			.optional(),
	},
	({ organizationId, input }) =>
		storeStep("contracts.bulk.listBatches", (db) =>
			listContractChangeBatches(db, organizationId, input ?? {}),
		),
);

export const getContractChangeBatchAction = organizationAction(
	{
		name: "contracts.bulk.getBatch",
		requires: "orgAdmin",
		schema: z.strictObject({
			batchId: uuidSchema,
			itemStatus: batchItemStatusSchema.optional(),
			limit: z.number().int().min(1).max(200).optional(),
			offset: z.number().int().min(0).optional(),
		}),
	},
	({ organizationId, input }) =>
		storeStep("contracts.bulk.getBatch", (db) =>
			getContractChangeBatch(db, organizationId, input.batchId, {
				itemStatus: input.itemStatus,
				limit: input.limit,
				offset: input.offset,
			}),
		),
);

// ============================================
// VALIDATED CSV CONTRACT & LEAVING-DATE IMPORT (#1928)
// ============================================

export const previewCsvContractImportAction = organizationAction(
	{
		name: "contracts.csv.previewContractImport",
		requires: "orgAdmin",
		schema: z.strictObject({
			csvText: z.string().min(1, "CSV content is required").max(10_000_000),
			defaultEffectiveFromDate: isoDateSchema.nullable().optional(),
			overwritePersonalDivergences: z.boolean().optional(),
			delimiter: z.enum([",", ";"]).optional(),
			maxPreviewRows: z.number().int().min(1).max(1000).optional(),
		}),
	},
	({ organizationId, input }) =>
		storeStep("contracts.csv.previewContractImport", (db) =>
			previewCsvContractImport(db, {
				organizationId,
				...input,
			}),
		),
);

export const previewCsvLeavingDateImportAction = organizationAction(
	{
		name: "contracts.csv.previewLeavingDateImport",
		requires: "orgAdmin",
		schema: z.strictObject({
			csvText: z.string().min(1, "CSV content is required").max(10_000_000),
			defaultAcknowledgeUnassignedDuties: z.boolean().optional(),
			delimiter: z.enum([",", ";"]).optional(),
			maxPreviewRows: z.number().int().min(1).max(1000).optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.csv.previewLeavingDateImport", (db) =>
			previewCsvLeavingDateImport(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
			}),
		),
);

export const commitCsvImportBatchAction = organizationAction(
	{
		name: "contracts.csv.commitImportBatch",
		requires: "orgAdmin",
		schema: z.strictObject({
			requestId: uuidSchema.optional(),
			operationKind: z.enum(["csv_contract_import", "csv_departure_import"]),
			csvText: z.string().min(1, "CSV content is required").max(10_000_000),
			confirmationFingerprint: z.string().min(64).max(64),
			defaultEffectiveFromDate: isoDateSchema.nullable().optional(),
			overwritePersonalDivergences: z.boolean().optional(),
			defaultAcknowledgeUnassignedDuties: z.boolean().optional(),
			delimiter: z.enum([",", ";"]).optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.csv.commitImportBatch", (db) =>
			commitCsvImportBatch(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
			}),
		),
);
