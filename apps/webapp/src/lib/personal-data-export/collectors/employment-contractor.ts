/**
 * The External Contractor engagement in the Employment category (#2001, spec #1935): the
 * contracting details and the effective-dated contractor compensation terms. Like an employee's
 * own wage in the employment terms, they are the contractor's own pay and details, not the
 * organization's pricing, so both export kinds hold them (Organization ADR 0003). The
 * organization's billable and cost rates stay withheld (`employment-withheld.ts`).
 *
 * Both tables are kept out of the schema barrel (TS2589), so they are imported directly.
 */

import { and, asc, eq } from "drizzle-orm";
import { contractorCompensationTerms } from "@/db/schema/contractor-compensation";
import { employeeContractorProfile } from "@/db/schema/contractor-profile";
import { formatContractorRate, fromStoredCompensation } from "@/lib/contractor-compensation/terms";
import type { PersonalDataExportDatabase, PersonalDataExportScope } from "../collector";

export async function loadContractorEngagement(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
) {
	const { organizationId, employeeId } = scope;
	const [details, terms] = await Promise.all([
		database
			.select({
				companyName: employeeContractorProfile.companyName,
				vatId: employeeContractorProfile.vatId,
				referenceCode: employeeContractorProfile.referenceCode,
				createdAt: employeeContractorProfile.createdAt,
				updatedAt: employeeContractorProfile.updatedAt,
				updatedBy: employeeContractorProfile.updatedBy,
			})
			.from(employeeContractorProfile)
			.where(
				and(
					eq(employeeContractorProfile.organizationId, organizationId),
					eq(employeeContractorProfile.employeeId, employeeId),
				),
			)
			.limit(1),
		database
			.select()
			.from(contractorCompensationTerms)
			.where(
				and(
					eq(contractorCompensationTerms.organizationId, organizationId),
					eq(contractorCompensationTerms.employeeId, employeeId),
				),
			)
			.orderBy(
				asc(contractorCompensationTerms.effectiveFrom),
				asc(contractorCompensationTerms.createdAt),
			),
	]);
	return {
		details: details[0] ?? null,
		terms: terms.map((row) => ({
			...row,
			// The rate in the terms' currency, with that currency's minor digits ("640.00", "9000").
			rate: formatContractorRate(fromStoredCompensation(row)),
		})),
	};
}

export const CONTRACTOR_TERMS_COLUMNS = [
	"id",
	"employment_period_id",
	"compensation_basis",
	"rate",
	"currency",
	"day_unit_rule",
	"half_day_threshold_minutes",
	"standard_day_minutes",
	"cap_at_one_day",
	"effective_from",
	"effective_to",
	"created_at",
	"created_by",
	"updated_at",
	"updated_by",
] as const;
