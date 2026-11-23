"use server";

import { Effect } from "effect";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { NotFoundError } from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { storeStep } from "@/lib/organization-action/store-step";
import { getTranslate } from "@/tolgee/server";
import { ContractorStatementRefused } from "./refusal";
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

			const statement = yield* storeStep(
				"contractorStatement.load",
				async (db) => {
					// Loaded on use: pages that render the export button never load the pricing store.
					const { loadContractorStatement } = await import("./loader");
					const result = await loadContractorStatement(db, organizationId, {
						employeeId: input.employeeId,
						fromDay: input.fromDay,
						toDay: input.toDay,
						generatedAt: systemClock.nowInstant(),
					});
					if (result.ok) return result.statement;
					if (result.reason === "employee_not_found") {
						throw new NotFoundError({
							message: "The contractor was not found",
							entityType: "employee",
						});
					}
					throw new ContractorStatementRefused(result.reason);
				},
				{ refusal: ContractorStatementRefused },
			);

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
