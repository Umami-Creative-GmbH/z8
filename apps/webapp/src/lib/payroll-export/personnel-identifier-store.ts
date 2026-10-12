/**
 * An employee custom field as payroll personnel identifier (#821), the database part.
 *
 * Values are read with the custom field as-of read (#818/#819) as the system:
 * field visibility does not apply, an admin chose the identifier on purpose.
 * Saving a configuration that names a field and archiving a field run under the
 * same per-organization custom field lock, so a configuration never names an
 * archived field.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import type { db as database } from "@/db";
import { customFieldDefinition, payrollExportConfig } from "@/db/schema";
import type { PlainDate } from "@/lib/datetime/temporal-core";
import { isUuid } from "@/lib/billable-time/input";
import type { CustomFieldReader } from "@/lib/organization/custom-fields/definitions";
import { lockCustomFieldDefinitions } from "@/lib/organization/custom-fields/lock";
import { readCustomFieldValues } from "@/lib/organization/custom-fields/values";
import {
	CUSTOM_FIELD_IDENTIFIER,
	EMPLOYEE_MATCH_CUSTOM_FIELD_KEY,
	PAYROLL_IDENTIFIER_FIELD_TYPES,
	PERSONNEL_NUMBER_CUSTOM_FIELD_KEY,
	payrollIdentifierCustomFieldId,
} from "./personnel-identifier";

type Database = typeof database;
type ConfigRow = typeof payrollExportConfig.$inferSelect;

/** Keeps each `IN` list well under PostgreSQL's bind-parameter limit. */
const ID_CHUNK = 5_000;

/**
 * Each employee's value of the identifier field as of `asOf`, by employee ID.
 * Employees without a value are absent; a tracked field resolves at `asOf`.
 * Only a text or number employee field of the organization yields values.
 */
export async function readPersonnelIdentifierValues(
	reader: CustomFieldReader,
	input: {
		organizationId: string;
		customFieldId: string;
		employeeIds: readonly string[];
		asOf: PlainDate;
	},
): Promise<Record<string, string>> {
	const values: Record<string, string> = {};
	const employeeIds = [...new Set(input.employeeIds)];
	// Sequential: a repeatable-read snapshot is one connection.
	for (let index = 0; index < employeeIds.length; index += ID_CHUNK) {
		const read = await readCustomFieldValues(reader, {
			organizationId: input.organizationId,
			entity: "employee",
			recordIds: employeeIds.slice(index, index + ID_CHUNK),
			asOf: input.asOf,
			viewer: { kind: "system" },
			includeArchivedFields: true,
		});
		const field = read.fields.find((candidate) => candidate.id === input.customFieldId);
		if (!field || !isIdentifierType(field.type)) return {};
		for (const [employeeId, byField] of Object.entries(read.values)) {
			const value = byField[field.id];
			if (value && typeof value.value === "string" && value.value !== "") {
				values[employeeId] = value.value;
			}
		}
	}
	return values;
}

function isIdentifierType(type: string): boolean {
	return (PAYROLL_IDENTIFIER_FIELD_TYPES as readonly string[]).includes(type);
}

/** The active employee custom fields a configuration may name as identifier, in order. */
export async function listPayrollIdentifierFields(
	reader: CustomFieldReader,
	organizationId: string,
): Promise<{ id: string; name: string; type: string }[]> {
	const rows = await reader
		.select({
			id: customFieldDefinition.id,
			name: customFieldDefinition.name,
			type: customFieldDefinition.type,
			archivedAt: customFieldDefinition.archivedAt,
		})
		.from(customFieldDefinition)
		.where(
			and(
				eq(customFieldDefinition.organizationId, organizationId),
				eq(customFieldDefinition.entity, "employee"),
			),
		)
		.orderBy(customFieldDefinition.position, customFieldDefinition.id);
	return rows
		.filter((row) => row.archivedAt === null && isIdentifierType(row.type))
		.map(({ id, name, type }) => ({ id, name, type }));
}

export type SavePayrollExportConfigOutcome =
	| { ok: true; config: ConfigRow }
	| { ok: false; reason: "invalid_identifier_field" };

/**
 * Saves the organization's configuration of one format. A configuration that
 * names a custom field identifier is refused unless the field is an active
 * employee field of type text or number of the same organization. A choice
 * other than a custom field drops any custom field ID left in the config.
 */
export async function savePayrollExportConfig(
	db: Database,
	input: {
		organizationId: string;
		formatId: string;
		config: Record<string, unknown>;
		actorUserId: string;
	},
): Promise<SavePayrollExportConfigOutcome> {
	const config = withoutUnusedCustomFieldIds(input.config);
	const fieldId = payrollIdentifierCustomFieldId(config);
	return db.transaction(async (tx) => {
		if (fieldId !== null) {
			await lockCustomFieldDefinitions(tx, input.organizationId);
			const eligible =
				isUuid(fieldId) &&
				(await listPayrollIdentifierFields(tx, input.organizationId)).some(
					(field) => field.id === fieldId,
				);
			if (!eligible) return { ok: false, reason: "invalid_identifier_field" } as const;
		}

		const [existing] = await tx
			.select({ id: payrollExportConfig.id })
			.from(payrollExportConfig)
			.where(
				and(
					eq(payrollExportConfig.organizationId, input.organizationId),
					eq(payrollExportConfig.formatId, input.formatId),
				),
			)
			.limit(1);
		if (existing) {
			const [updated] = await tx
				.update(payrollExportConfig)
				.set({ config, updatedBy: input.actorUserId })
				.where(
					and(
						eq(payrollExportConfig.id, existing.id),
						eq(payrollExportConfig.organizationId, input.organizationId),
					),
				)
				.returning();
			return { ok: true, config: updated } as const;
		}
		const [inserted] = await tx
			.insert(payrollExportConfig)
			.values({
				organizationId: input.organizationId,
				formatId: input.formatId,
				config,
				isActive: true,
				createdBy: input.actorUserId,
				updatedAt: new Date(),
			})
			.returning();
		return { ok: true, config: inserted } as const;
	});
}

function withoutUnusedCustomFieldIds(config: Record<string, unknown>): Record<string, unknown> {
	const next = { ...config };
	if (next.personnelNumberType !== CUSTOM_FIELD_IDENTIFIER) {
		delete next[PERSONNEL_NUMBER_CUSTOM_FIELD_KEY];
	}
	if (next.employeeMatchStrategy !== CUSTOM_FIELD_IDENTIFIER) {
		delete next[EMPLOYEE_MATCH_CUSTOM_FIELD_KEY];
	}
	return next;
}
