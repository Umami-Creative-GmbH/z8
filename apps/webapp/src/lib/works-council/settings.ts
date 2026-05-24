import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
	type WorksCouncilAbsenceVisibility,
	type WorksCouncilIdentityVisibility,
	worksCouncilAccessAudit,
	worksCouncilSettings,
} from "@/db/schema";

export interface WorksCouncilSettingsInput {
	enabled?: unknown;
	identityVisibility?: unknown;
	absenceVisibility?: unknown;
	exportEnabled?: unknown;
	minimumAggregationThreshold?: unknown;
	visibleTeamIds?: unknown;
	visibleLocationIds?: unknown;
}

export interface WorksCouncilSettingsFormValues {
	enabled: boolean;
	identityVisibility: WorksCouncilIdentityVisibility;
	absenceVisibility: WorksCouncilAbsenceVisibility;
	exportEnabled: boolean;
	minimumAggregationThreshold: number;
	visibleTeamIds: string[];
	visibleLocationIds: string[];
}

export const DEFAULT_WORKS_COUNCIL_SETTINGS: WorksCouncilSettingsFormValues = {
	enabled: false,
	identityVisibility: "aggregated",
	absenceVisibility: "hidden",
	exportEnabled: false,
	minimumAggregationThreshold: 5,
	visibleTeamIds: [],
	visibleLocationIds: [],
};

const IDENTITY_VISIBILITY_VALUES = ["aggregated", "pseudonymized", "named"] as const;
const ABSENCE_VISIBILITY_VALUES = ["hidden", "grouped", "category"] as const;

function isIdentityVisibility(value: unknown): value is WorksCouncilIdentityVisibility {
	return IDENTITY_VISIBILITY_VALUES.includes(value as never);
}

function isAbsenceVisibility(value: unknown): value is WorksCouncilAbsenceVisibility {
	return ABSENCE_VISIBILITY_VALUES.includes(value as never);
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
	return typeof value === "boolean" ? value : fallback;
}

function sanitizeStringIds(value: unknown) {
	const values = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];

	return values.flatMap((item) => {
		if (typeof item !== "string") return [];
		const trimmed = item.trim();
		return trimmed === "" ? [] : [trimmed];
	});
}

export function normalizeWorksCouncilSettingsInput(
	input: WorksCouncilSettingsInput,
): WorksCouncilSettingsFormValues {
	const threshold =
		typeof input.minimumAggregationThreshold === "number" &&
		Number.isFinite(input.minimumAggregationThreshold)
			? input.minimumAggregationThreshold
			: DEFAULT_WORKS_COUNCIL_SETTINGS.minimumAggregationThreshold;

	return {
		enabled: sanitizeBoolean(input.enabled, DEFAULT_WORKS_COUNCIL_SETTINGS.enabled),
		identityVisibility: isIdentityVisibility(input.identityVisibility)
			? input.identityVisibility
			: DEFAULT_WORKS_COUNCIL_SETTINGS.identityVisibility,
		absenceVisibility: isAbsenceVisibility(input.absenceVisibility)
			? input.absenceVisibility
			: DEFAULT_WORKS_COUNCIL_SETTINGS.absenceVisibility,
		exportEnabled: sanitizeBoolean(
			input.exportEnabled,
			DEFAULT_WORKS_COUNCIL_SETTINGS.exportEnabled,
		),
		minimumAggregationThreshold: Math.max(
			DEFAULT_WORKS_COUNCIL_SETTINGS.minimumAggregationThreshold,
			threshold,
		),
		visibleTeamIds: sanitizeStringIds(input.visibleTeamIds),
		visibleLocationIds: sanitizeStringIds(input.visibleLocationIds),
	};
}

export async function loadWorksCouncilSettings(organizationId: string) {
	const row = await db.query.worksCouncilSettings.findFirst({
		where: eq(worksCouncilSettings.organizationId, organizationId),
	});

	return row ?? { organizationId, ...DEFAULT_WORKS_COUNCIL_SETTINGS };
}

export async function saveWorksCouncilSettings(
	input: WorksCouncilSettingsInput & { organizationId: string; actorUserId: string },
) {
	const normalized = normalizeWorksCouncilSettingsInput(input);
	const [row] = await db.transaction(async (tx) => {
		const savedRows = await tx
			.insert(worksCouncilSettings)
			.values({
				...normalized,
				organizationId: input.organizationId,
				createdBy: input.actorUserId,
				updatedBy: input.actorUserId,
			})
			.onConflictDoUpdate({
				target: worksCouncilSettings.organizationId,
				set: { ...normalized, updatedBy: input.actorUserId },
			})
			.returning();

		await tx.insert(worksCouncilAccessAudit).values({
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			eventType: "settings_updated",
			metadata: { settings: normalized },
		});

		return savedRows;
	});

	return row;
}
