"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { employee, legalEntity, legalEntityAdmin } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import {
	legalEntityFormSchema,
	type LegalEntityFormValues,
} from "@/lib/validations/legal-entity";

const LEGAL_ENTITIES_SETTINGS_PATH = "/settings/legal-entities";

type LegalEntityActionResult<T = void> =
	| { success: true; data: T }
	| { success: false; errors: string[] };

function validationErrors(error: { issues: { message: string }[] }) {
	return error.issues.map((issue) => issue.message);
}

export async function getLegalEntities(): Promise<(typeof legalEntity.$inferSelect)[]> {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return db.query.legalEntity.findMany({
		where: eq(legalEntity.organizationId, organizationId),
	});
}

export async function createLegalEntity(
	values: LegalEntityFormValues,
): Promise<LegalEntityActionResult<typeof legalEntity.$inferSelect>> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const parsed = legalEntityFormSchema.safeParse(values);

	if (!parsed.success) {
		return { success: false, errors: validationErrors(parsed.error) };
	}

	const now = new Date();
	const [created] = await db
		.insert(legalEntity)
		.values({
			...parsed.data,
			organizationId,
			isDefault: false,
			createdBy: authContext.user.id,
			updatedAt: now,
			updatedBy: authContext.user.id,
		})
		.returning();

	revalidatePath(LEGAL_ENTITIES_SETTINGS_PATH);

	return { success: true, data: created };
}

export async function updateLegalEntity(
	id: string,
	values: LegalEntityFormValues,
): Promise<LegalEntityActionResult<typeof legalEntity.$inferSelect>> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const parsed = legalEntityFormSchema.safeParse(values);

	if (!parsed.success) {
		return { success: false, errors: validationErrors(parsed.error) };
	}

	const [updated] = await db
		.update(legalEntity)
		.set({
			...parsed.data,
			updatedAt: new Date(),
			updatedBy: authContext.user.id,
		})
		.where(and(eq(legalEntity.id, id), eq(legalEntity.organizationId, organizationId)))
		.returning();

	if (!updated) {
		return { success: false, errors: ["Legal entity not found"] };
	}

	revalidatePath(LEGAL_ENTITIES_SETTINGS_PATH);

	return { success: true, data: updated };
}

export async function setDefaultLegalEntity(id: string): Promise<LegalEntityActionResult> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const selected = await db.query.legalEntity.findFirst({
		where: and(eq(legalEntity.id, id), eq(legalEntity.organizationId, organizationId)),
	});

	if (!selected) {
		return { success: false, errors: ["Legal entity not found"] };
	}

	await db.transaction(async (tx) => {
		await tx
			.update(legalEntity)
			.set({
				isDefault: false,
				updatedAt: new Date(),
				updatedBy: authContext.user.id,
			})
			.where(and(eq(legalEntity.organizationId, organizationId), ne(legalEntity.id, id)));

		await tx
			.update(legalEntity)
			.set({
				isDefault: true,
				isActive: true,
				updatedAt: new Date(),
				updatedBy: authContext.user.id,
			})
			.where(and(eq(legalEntity.id, id), eq(legalEntity.organizationId, organizationId)));
	});

	revalidatePath(LEGAL_ENTITIES_SETTINGS_PATH);

	return { success: true, data: undefined };
}

export async function grantLegalEntityAdmin(
	legalEntityId: string,
	employeeId: string,
): Promise<LegalEntityActionResult<typeof legalEntityAdmin.$inferSelect | null>> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const selectedEntity = await db.query.legalEntity.findFirst({
		where: and(
			eq(legalEntity.id, legalEntityId),
			eq(legalEntity.organizationId, organizationId),
		),
	});

	if (!selectedEntity) {
		return { success: false, errors: ["Legal entity not found"] };
	}

	const selectedEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, employeeId),
			eq(employee.organizationId, organizationId),
			eq(employee.legalEntityId, legalEntityId),
		),
	});

	if (!selectedEmployee) {
		return { success: false, errors: ["Employee does not belong to this legal entity"] };
	}

	const [created] = await db
		.insert(legalEntityAdmin)
		.values({
			organizationId,
			legalEntityId,
			employeeId,
			createdBy: authContext.user.id,
		})
		.onConflictDoNothing({
			target: [legalEntityAdmin.legalEntityId, legalEntityAdmin.employeeId],
		})
		.returning();

	revalidatePath(LEGAL_ENTITIES_SETTINGS_PATH);

	return { success: true, data: created ?? null };
}
