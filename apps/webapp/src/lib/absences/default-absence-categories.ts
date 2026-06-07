import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { absenceCategory } from "@/db/schema";

export const defaultAbsenceCategories = [
	{
		type: "vacation",
		name: "Vacation",
		description: "Paid time off",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: true,
		color: "#10b981",
	},
	{
		type: "sick",
		name: "Sick Leave",
		description: "Sick day",
		requiresWorkTime: false,
		requiresApproval: false,
		countsAgainstVacation: false,
		color: "#ef4444",
	},
	{
		type: "personal",
		name: "Personal Day",
		description: "Personal time off",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#8b5cf6",
	},
	{
		type: "home_office",
		name: "Home Office",
		description: "Remote work day",
		requiresWorkTime: true,
		requiresApproval: false,
		countsAgainstVacation: false,
		color: "#3b82f6",
	},
	{
		type: "unpaid",
		name: "Unpaid Leave",
		description: "Unpaid absence",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#f59e0b",
	},
	{
		type: "parental",
		name: "Parental Leave",
		description: "Parental leave absence",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#06b6d4",
	},
	{
		type: "bereavement",
		name: "Bereavement",
		description: "Bereavement leave",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#64748b",
	},
] satisfies Array<Omit<typeof absenceCategory.$inferInsert, "organizationId" | "isActive">>;

export const defaultAbsenceCategoryI18n = {
	vacation: {
		nameKey: "settings.absenceCategories.defaults.vacation.name",
		descriptionKey: "settings.absenceCategories.defaults.vacation.description",
	},
	sick: {
		nameKey: "settings.absenceCategories.defaults.sick.name",
		descriptionKey: "settings.absenceCategories.defaults.sick.description",
	},
	personal: {
		nameKey: "settings.absenceCategories.defaults.personal.name",
		descriptionKey: "settings.absenceCategories.defaults.personal.description",
	},
	home_office: {
		nameKey: "settings.absenceCategories.defaults.homeOffice.name",
		descriptionKey: "settings.absenceCategories.defaults.homeOffice.description",
	},
	unpaid: {
		nameKey: "settings.absenceCategories.defaults.unpaid.name",
		descriptionKey: "settings.absenceCategories.defaults.unpaid.description",
	},
	parental: {
		nameKey: "settings.absenceCategories.defaults.parental.name",
		descriptionKey: "settings.absenceCategories.defaults.parental.description",
	},
	bereavement: {
		nameKey: "settings.absenceCategories.defaults.bereavement.name",
		descriptionKey: "settings.absenceCategories.defaults.bereavement.description",
	},
} as const;

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
