import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { absenceCategory } from "@/db/schema";
import { builtInAbsenceCategoryText } from "./category-display";

export const defaultAbsenceCategories = [
	{
		type: "vacation",
		name: builtInAbsenceCategoryText.vacation.name,
		description: builtInAbsenceCategoryText.vacation.description,
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: true,
		color: "#10b981",
	},
	{
		type: "sick",
		name: builtInAbsenceCategoryText.sick.name,
		description: builtInAbsenceCategoryText.sick.description,
		requiresWorkTime: false,
		requiresApproval: false,
		countsAgainstVacation: false,
		color: "#ef4444",
	},
	{
		type: "personal",
		name: builtInAbsenceCategoryText.personal.name,
		description: builtInAbsenceCategoryText.personal.description,
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#8b5cf6",
	},
	{
		type: "home_office",
		name: builtInAbsenceCategoryText.home_office.name,
		description: builtInAbsenceCategoryText.home_office.description,
		requiresWorkTime: true,
		requiresApproval: false,
		countsAgainstVacation: false,
		color: "#3b82f6",
	},
	{
		type: "unpaid",
		name: builtInAbsenceCategoryText.unpaid.name,
		description: builtInAbsenceCategoryText.unpaid.description,
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#f59e0b",
	},
	{
		type: "parental",
		name: builtInAbsenceCategoryText.parental.name,
		description: builtInAbsenceCategoryText.parental.description,
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#06b6d4",
	},
	{
		type: "bereavement",
		name: builtInAbsenceCategoryText.bereavement.name,
		description: builtInAbsenceCategoryText.bereavement.description,
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#64748b",
	},
	{
		// #1000: organizations that existed before it got it inactive (migration 0187).
		type: "time_off_in_lieu",
		name: builtInAbsenceCategoryText.time_off_in_lieu.name,
		description: builtInAbsenceCategoryText.time_off_in_lieu.description,
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		drawsOnWorkBalance: true,
		color: "#14b8a6",
	},
] satisfies Array<Omit<typeof absenceCategory.$inferInsert, "organizationId" | "isActive">>;

export async function ensureDefaultAbsenceCategoriesForOrganization(organizationId: string) {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('absence_category_defaults'), hashtext(${organizationId}))`,
		);

		const existingCategories = await tx.query.absenceCategory.findMany({
			where: eq(absenceCategory.organizationId, organizationId),
		});

		const existingTypes = new Set(existingCategories.map((category) => category.type));
		const categoriesToCreate = defaultAbsenceCategories.flatMap((category) =>
			!existingTypes.has(category.type)
				? [
						{
							...category,
							organizationId,
							isActive: true,
						},
					]
				: [],
		);

		if (categoriesToCreate.length === 0) {
			return { created: 0 };
		}

		await tx.insert(absenceCategory).values(categoriesToCreate);

		return { created: categoriesToCreate.length };
	});
}
