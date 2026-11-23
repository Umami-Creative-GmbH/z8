import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employeeContractorProfile } from "@/db/schema/contractor-profile";

type ProfileClient = Pick<typeof appDb, "insert" | "select">;

/** The optional contracting details of an External Contractor (#1995). */
export type ContractorProfileDetails = {
	companyName: string | null;
	vatId: string | null;
	referenceCode: string | null;
};

const LIMITS = { companyName: 200, vatId: 50, referenceCode: 100 } as const;

/** Trimmed, empty as null; the database checks the same lengths. */
export function normalizeContractorProfileDetails(
	details: Partial<Record<keyof ContractorProfileDetails, string | null | undefined>>,
): ContractorProfileDetails {
	const clean = (value: string | null | undefined, max: number) => {
		const trimmed = value?.trim() ?? "";
		return trimmed === "" ? null : trimmed.slice(0, max);
	};
	return {
		companyName: clean(details.companyName, LIMITS.companyName),
		vatId: clean(details.vatId, LIMITS.vatId),
		referenceCode: clean(details.referenceCode, LIMITS.referenceCode),
	};
}

export function hasContractorProfileDetails(details: ContractorProfileDetails): boolean {
	return details.companyName !== null || details.vatId !== null || details.referenceCode !== null;
}

/** Writes (or replaces) the contractor's details, scoped to its organization. */
export async function saveContractorProfile(
	client: ProfileClient,
	input: {
		organizationId: string;
		employeeId: string;
		details: ContractorProfileDetails;
		updatedBy: string | null;
	},
): Promise<void> {
	await client
		.insert(employeeContractorProfile)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			...input.details,
			updatedBy: input.updatedBy,
		})
		.onConflictDoUpdate({
			target: [employeeContractorProfile.organizationId, employeeContractorProfile.employeeId],
			set: { ...input.details, updatedBy: input.updatedBy },
		});
}

export async function loadContractorProfile(
	client: Pick<typeof appDb, "select">,
	input: { organizationId: string; employeeId: string },
): Promise<ContractorProfileDetails | null> {
	const [row] = await client
		.select({
			companyName: employeeContractorProfile.companyName,
			vatId: employeeContractorProfile.vatId,
			referenceCode: employeeContractorProfile.referenceCode,
		})
		.from(employeeContractorProfile)
		.where(
			and(
				eq(employeeContractorProfile.organizationId, input.organizationId),
				eq(employeeContractorProfile.employeeId, input.employeeId),
			),
		);
	return row ?? null;
}
