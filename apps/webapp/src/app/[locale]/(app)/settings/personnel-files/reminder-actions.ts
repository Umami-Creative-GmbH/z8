"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateExpiryReminderLeadDays } from "@/lib/expiry-reminders/expiry";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { personnelFileStoreWork, whilePersonnelFilesOn } from "@/lib/personnel-file/administration";
import { saveExpiryReminderLeadDays } from "@/lib/personnel-file/expiry-store";

/** A whole number of days in range, given as a number or a numeric string. */
const leadDaysSchema = z.unknown().transform((value, context) => {
	const validation = validateExpiryReminderLeadDays(value);
	if (validation.ok) return validation.value;
	context.addIssue({ code: "custom", message: validation.message });
	return z.NEVER;
});

/**
 * Expiry reminder settings (#869): the lead time in days before an expiry
 * date at which officers and employees are reminded. Changed by owners and
 * admins on the Reminders tab of Settings → Personnel files.
 */
export const savePersonnelFileExpiryLeadDaysAction = organizationAction(
	{
		name: "personnelFile.saveExpiryLeadDays",
		requires: "orgAdmin",
		schema: z.strictObject({ leadDays: leadDaysSchema }),
	},
	({ actor, organizationId, input }) =>
		whilePersonnelFilesOn(
			organizationId,
			"Only owners and admins can change the reminder lead time",
			personnelFileStoreWork("personnelFile.saveExpiryLeadDays", async (db) => {
				await saveExpiryReminderLeadDays(db, {
					organizationId,
					leadDays: input.leadDays,
					actorUserId: actor.userId,
				});
				revalidatePath("/settings/personnel-files");
				revalidatePath("/personnel-files");
				return { leadDays: input.leadDays };
			}),
		),
);
