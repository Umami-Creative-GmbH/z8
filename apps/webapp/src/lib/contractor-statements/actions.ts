"use server";

import { Effect } from "effect";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { getTranslate } from "@/tolgee/server";
import { type ContractorStatementRefusal, loadContractorStatement } from "./loader";
import { contractorStatementCsv, contractorStatementFilename } from "./statement-csv";

/**
 * Contractor Time & Fee Statement exports (#2000, spec #1935). One action for
 * both entry points: org admins (Employee Detail) export any contractor of
 * their organization; anyone else exports only their own statement (Time
 * Tracking self-service). Scoped managers are refused for everyone but
 * themselves before anything is read, so contractor rates and fee totals never
 * reach them. The statement itself never carries Billable Time rates, cost
 * rates or margins (`statement.ts`), so a contractor's own copy cannot show
 * them either. The file is written in the exporter's language.
 */

const logger = createLogger("ContractorStatementActions");

export type ContractorStatementFormat = "csv" | "pdf";

export interface ContractorStatementFile {
	filename: string;
	contentType: string;
	/** The file's bytes, base64. */
	base64: string;
}

const daySchema = z.string().max(10);

const REFUSALS: Record<Exclude<ContractorStatementRefusal, "employee_not_found">, string> = {
	not_contractor: "This person had no External Contractor engagement in this period",
	invalid_period: "Choose a period of at most one year whose first day is not after its last",
};

function refusalError(reason: ContractorStatementRefusal) {
	if (reason === "employee_not_found") {
		return new NotFoundError({ message: "The contractor was not found", entityType: "employee" });
	}
	return new ValidationError({ message: REFUSALS[reason], refusal: reason });
}

export const exportContractorStatement = organizationAction(
	{
		name: "contractorStatement.export",
		requires: "member",
		schema: z.strictObject({
			employeeId: z.uuid({ message: "Choose a contractor" }),
			fromDay: daySchema,
			toDay: daySchema,
			format: z.enum(["csv", "pdf"]),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const isOrgAdmin = meetsSettingsAccess(actor.settingsAccess, "orgAdmin");
			const isOwnStatement = actor.employee !== null && actor.employee.id === input.employeeId;
			yield* refuseUnless(isOrgAdmin || isOwnStatement, {
				userId: actor.userId,
				message: "You can download only your own contractor statements",
				resource: "contractorStatement",
				action: "export",
			});

			const service = yield* DatabaseService;
			const result = yield* service.query("contractorStatement.load", () =>
				loadContractorStatement(service.db, organizationId, {
					employeeId: input.employeeId,
					fromDay: input.fromDay,
					toDay: input.toDay,
					generatedAt: systemClock.nowInstant(),
				}),
			);
			if (!result.ok) return yield* Effect.fail(refusalError(result.reason));
			const { statement } = result;

			const [t, locale] = yield* Effect.promise(() => Promise.all([getTranslate(), getLocale()]));
			const file: ContractorStatementFile =
				input.format === "csv"
					? {
							filename: contractorStatementFilename(statement, "csv"),
							contentType: "text/csv; charset=utf-8",
							base64: Buffer.from(contractorStatementCsv(statement, { t }), "utf8").toString(
								"base64",
							),
						}
					: {
							filename: contractorStatementFilename(statement, "pdf"),
							contentType: "application/pdf",
							base64: Buffer.from(
								yield* Effect.promise(async () => {
									const { renderContractorStatementPdf } = await import("./statement-pdf");
									return renderContractorStatementPdf(statement, { t, locale });
								}),
							).toString("base64"),
						};

			logger.info(
				{
					organizationId,
					employeeId: input.employeeId,
					format: input.format,
					own: isOwnStatement,
					days: statement.days.length,
				},
				"Contractor statement exported",
			);
			return file;
		}),
);
