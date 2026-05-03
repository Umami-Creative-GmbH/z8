import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntity } from "@/db/schema";

export interface BuildDefaultLegalEntityValuesInput {
	organizationId: string;
	organizationName: string;
	createdBy: string | null;
}

export function buildDefaultLegalEntityValues(input: BuildDefaultLegalEntityValuesInput) {
	return {
		organizationId: input.organizationId,
		name: input.organizationName,
		legalName: input.organizationName,
		defaultCurrency: "EUR",
		timezone: "Europe/Berlin",
		isDefault: true,
		isActive: true,
		createdBy: input.createdBy,
		updatedBy: input.createdBy,
	};
}

export async function getDefaultLegalEntity(organizationId: string) {
	const [entity] = await db
		.select()
		.from(legalEntity)
		.where(
			and(
				eq(legalEntity.organizationId, organizationId),
				eq(legalEntity.isDefault, true),
				eq(legalEntity.isActive, true),
			),
		)
		.limit(1);

	return entity ?? null;
}
