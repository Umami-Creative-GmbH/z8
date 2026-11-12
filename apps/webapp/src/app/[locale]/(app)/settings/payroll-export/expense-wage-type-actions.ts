"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import {
	getExpenseWageTypeMappings,
	saveExpenseWageTypeMapping,
} from "@/lib/payroll-export/expense-wage-type";
import type {
	ExpenseWageTypeCodes,
	ExpenseWageTypeMapping,
} from "@/lib/payroll-export/expense-wage-type.types";
import type { PayrollLineKind } from "@/lib/travel-expenses/payroll-line-kind";
import { getReimbursementChannel } from "@/lib/travel-expenses/reimbursement-channel";
import type { ReimbursementChannel } from "@/lib/travel-expenses/reimbursement-channel.types";

/**
 * Expense wage types on the payroll export settings (#851). Only organization
 * administrators (owners and admins) read or change them. The section shows only
 * while the organization pays reimbursements through the payroll run; the
 * mappings are kept when it pays by bank transfer.
 */

export interface ExpenseWageTypeSetting {
	channel: ReimbursementChannel;
	mappings: ExpenseWageTypeMapping[];
}

// The store checks the kind and the codes and answers "invalid" for anything else.
const saveExpenseWageTypeSchema = z.strictObject({
	kind: z.custom<PayrollLineKind>(
		(value) => typeof value === "string",
		"Invalid wage type mapping",
	),
	codes: z.custom<ExpenseWageTypeCodes>(
		(value) => typeof value === "object" && value !== null,
		"Invalid wage type mapping",
	),
});

export const getExpenseWageTypeSetting = organizationAction(
	{ name: "payrollExport.getExpenseWageTypes", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const [channel, mappings] = yield* dbService.query("payrollExport.getExpenseWageTypes", () =>
				Promise.all([
					getReimbursementChannel(organizationId, { database: dbService.db }),
					getExpenseWageTypeMappings(organizationId, { database: dbService.db }),
				]),
			);
			return { channel, mappings } satisfies ExpenseWageTypeSetting;
		}),
);

export const saveExpenseWageTypeSetting = organizationAction(
	{
		name: "payrollExport.saveExpenseWageType",
		requires: "orgAdmin",
		schema: saveExpenseWageTypeSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query("payrollExport.saveExpenseWageType", () =>
				saveExpenseWageTypeMapping(
					{ organizationId, actorUserId: actor.userId, kind: input.kind, codes: input.codes },
					{ database: dbService.db },
				),
			);
			if (result.status === "invalid") {
				return yield* Effect.fail(
					new ValidationError({ message: "Invalid wage type mapping", field: "codes" }),
				);
			}
			if (result.status === "saved") revalidatePath("/settings/payroll-export");
			return result.mapping;
		}),
);
