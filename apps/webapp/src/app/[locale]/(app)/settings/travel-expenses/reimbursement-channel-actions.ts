"use server";

import { Effect } from "effect";
import { z } from "zod";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import { isPayrollRunPreviewOpen } from "@/lib/travel-expenses/payroll-run-preview";
import {
	countUnconfirmedPayrollRuns,
	getReimbursementChannel,
	saveReimbursementChannel,
} from "@/lib/travel-expenses/reimbursement-channel";
import {
	REIMBURSEMENT_CHANNELS,
	type ReimbursementChannel,
} from "@/lib/travel-expenses/reimbursement-channel.types";
import { revalidateExpenseSettings } from "./expense-settings-effects";

/**
 * The organization's reimbursement channel (#849). Only organization
 * administrators (owners and admins) read or change it; the payroll run is
 * offered only while the organization passes its preview gate.
 */

export interface ReimbursementChannelSetting {
	channel: ReimbursementChannel;
	/** Whether the organization passes the payroll run preview gate. */
	payrollRunAvailable: boolean;
	/** Payroll runs that can still be confirmed or discarded. */
	unconfirmedPayrollRuns: number;
}

/** The setting as the card shows it; a just-saved channel is not read back. */
async function readSetting(
	database: DatabaseClient,
	organizationId: string,
	savedChannel?: ReimbursementChannel,
): Promise<ReimbursementChannelSetting> {
	const [current, payrollRunAvailable, unconfirmedPayrollRuns] = await Promise.all([
		savedChannel ?? getReimbursementChannel(organizationId, { database }),
		isPayrollRunPreviewOpen(organizationId, { database }),
		countUnconfirmedPayrollRuns(organizationId, { database }),
	]);
	return { channel: current, payrollRunAvailable, unconfirmedPayrollRuns };
}

export const getReimbursementChannelSetting = organizationAction(
	{ name: "travelExpenses.getReimbursementChannel", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		storeStep(
			"travelExpenses.getReimbursementChannel",
			(database) => readSetting(database, organizationId),
			{ failure: "Failed to load the reimbursement channel" },
		),
);

export const saveReimbursementChannelSetting = organizationAction(
	{
		name: "travelExpenses.saveReimbursementChannel",
		requires: "orgAdmin",
		schema: z.strictObject({
			channel: z.enum(REIMBURSEMENT_CHANNELS, "Invalid reimbursement channel"),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const failure = "Failed to save the reimbursement channel";
			const result = yield* storeStep(
				"travelExpenses.saveReimbursementChannel",
				(database) =>
					saveReimbursementChannel(
						{ organizationId, actorUserId: actor.userId, channel: input.channel },
						{ database },
					),
				{ failure: failure },
			);
			if (result.kind === "invalid") {
				return yield* Effect.fail(
					new ValidationError({ message: "Invalid reimbursement channel", field: "channel" }),
				);
			}
			if (result.kind === "preview_closed") {
				return yield* Effect.fail(
					new ValidationError({
						message: "The payroll run is not available for this organization",
						field: "channel",
					}),
				);
			}
			if (result.kind === "saved") yield* revalidateExpenseSettings();
			return yield* storeStep(
				"travelExpenses.readReimbursementChannel",
				(database) => readSetting(database, organizationId, result.channel),
				{ failure: failure },
			);
		}),
);
