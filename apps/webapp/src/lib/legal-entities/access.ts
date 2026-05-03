import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { legalEntity } from "@/db/schema";
import { getDefaultLegalEntity } from "./default-entity";

export interface LegalEntityAccessScope {
	isOrgAdmin: boolean;
	allowedLegalEntityIds: string[];
}

export function canAccessLegalEntity(scope: LegalEntityAccessScope, legalEntityId: string) {
	return scope.isOrgAdmin || scope.allowedLegalEntityIds.includes(legalEntityId);
}

export interface ResolveSelectedLegalEntityIdInput extends LegalEntityAccessScope {
	requestedLegalEntityId: string | null;
	defaultLegalEntityId: string;
}

export function resolveSelectedLegalEntityId(input: ResolveSelectedLegalEntityIdInput) {
	if (input.requestedLegalEntityId) {
		if (!canAccessLegalEntity(input, input.requestedLegalEntityId)) {
			throw new Error("You do not have access to this legal entity.");
		}

		return input.requestedLegalEntityId;
	}

	if (input.isOrgAdmin) {
		return input.defaultLegalEntityId;
	}

	if (input.allowedLegalEntityIds.includes(input.defaultLegalEntityId)) {
		return input.defaultLegalEntityId;
	}

	const [firstAllowedEntity] = input.allowedLegalEntityIds;
	if (!firstAllowedEntity) {
		throw new Error("No legal entity access is available for this user.");
	}

	return firstAllowedEntity;
}

export async function getLegalEntitySelectionContext(input: {
	organizationId: string;
	requestedLegalEntityId: string | null;
	isOrgAdmin: boolean;
	allowedLegalEntityIds: string[];
}) {
	const defaultEntity = await getDefaultLegalEntity(input.organizationId);

	if (!defaultEntity) {
		throw new Error("No default legal entity exists for this organization.");
	}

	const whereClause = input.isOrgAdmin
		? eq(legalEntity.organizationId, input.organizationId)
		: and(
				eq(legalEntity.organizationId, input.organizationId),
				inArray(legalEntity.id, input.allowedLegalEntityIds),
			);

	const entities = await db.select().from(legalEntity).where(whereClause);
	const organizationLegalEntityIds = entities.map((entity) => entity.id);
	const allowedLegalEntityIds = input.isOrgAdmin
		? organizationLegalEntityIds
		: organizationLegalEntityIds.filter((entityId) => input.allowedLegalEntityIds.includes(entityId));
	const selectedLegalEntityId = resolveSelectedLegalEntityId({
		requestedLegalEntityId: input.requestedLegalEntityId,
		defaultLegalEntityId: defaultEntity.id,
		isOrgAdmin: false,
		allowedLegalEntityIds,
	});

	return { entities, selectedLegalEntityId };
}
