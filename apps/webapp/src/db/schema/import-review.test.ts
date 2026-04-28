import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	importBatch,
	importBatchJob,
	importIssue,
	importJobSecret,
	importRejectedExport,
	importStagedRow,
} from "./index";

function hasCompositeForeignKey(
	table: Parameters<typeof getTableConfig>[0],
	columns: string[],
	foreignTable: Parameters<typeof getTableConfig>[0],
	foreignColumns: string[],
): boolean {
	return getTableConfig(table).foreignKeys.some((foreignKey) => {
		const reference = foreignKey.reference();

		return (
			reference.columns.map((column) => column.name).join(",") === columns.join(",")
			&& reference.foreignColumns.map((column) => column.name).join(",")
				=== foreignColumns.join(",")
			&& reference.foreignColumns.every((column) => column.table === foreignTable)
		);
	});
}

function uniqueConstraintNames(table: Parameters<typeof getTableConfig>[0]): string[] {
	return getTableConfig(table).uniqueConstraints.map((constraint) => constraint.getName());
}

describe("import review schema exports", () => {
	it("exports all import review tables", () => {
		expect(importBatch).toBeDefined();
		expect(importBatchJob).toBeDefined();
		expect(importStagedRow).toBeDefined();
		expect(importIssue).toBeDefined();
		expect(importRejectedExport).toBeDefined();
		expect(importJobSecret).toBeDefined();
	});

	it("enforces tenant-safe batch and staged row relationships", () => {
		expect(uniqueConstraintNames(importBatch)).toEqual(
			expect.arrayContaining(["importBatch_id_organizationId_idx"]),
		);
		expect(uniqueConstraintNames(importStagedRow)).toEqual(
			expect.arrayContaining(["importStagedRow_id_batch_org_idx"]),
		);

		for (const table of [
			importBatchJob,
			importStagedRow,
			importIssue,
			importRejectedExport,
			importJobSecret,
		]) {
			expect(
				hasCompositeForeignKey(
					table,
					["batch_id", "organization_id"],
					importBatch,
					["id", "organization_id"],
				),
			).toBe(true);
		}

		expect(
			hasCompositeForeignKey(
				importIssue,
				["staged_row_id", "batch_id", "organization_id"],
				importStagedRow,
				["id", "batch_id", "organization_id"],
			),
		).toBe(true);
	});

	it("includes a migration for the import review tables", () => {
		const migration = readFileSync("drizzle/0005_import_review.sql", "utf8");

		for (const tableName of [
			"import_batch",
			"import_batch_job",
			"import_staged_row",
			"import_issue",
			"import_rejected_export",
			"import_job_secret",
		]) {
			expect(migration).toContain(`CREATE TABLE "${tableName}"`);
		}

		expect(migration).toContain(
			'CONSTRAINT "importBatch_id_organizationId_idx" UNIQUE("id","organization_id")',
		);
		expect(migration).toContain(
			'CONSTRAINT "importStagedRow_id_batch_org_idx" UNIQUE("id","batch_id","organization_id")',
		);
		expect(migration).toContain(
			'FOREIGN KEY ("batch_id","organization_id") REFERENCES "public"."import_batch"("id","organization_id") ON DELETE cascade ON UPDATE no action',
		);
		expect(migration).toContain(
			'FOREIGN KEY ("staged_row_id","batch_id","organization_id") REFERENCES "public"."import_staged_row"("id","batch_id","organization_id") ON DELETE cascade ON UPDATE no action',
		);
	});
});
