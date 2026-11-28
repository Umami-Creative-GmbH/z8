import { systemClock } from "@/lib/datetime/temporal-core";
import { retryPersonalDetailsChangedEmails } from "@/lib/organization/personal-details/personal-details";
import type { ChangedEmailRetryResult } from "@/lib/organization/personal-details/changed-notice";

export type PersonalDetailsChangedEmailsJobResult = ChangedEmailRetryResult;

/**
 * The mandatory "personal details changed" email (#2069) is recorded with the
 * change and attempted right after commit; this sweep retries the ones that
 * failed or whose attempt never finished, until each is sent or no email can
 * reach the employee. Each change's email is sent once.
 */
export async function runPersonalDetailsChangedEmailsJob(): Promise<PersonalDetailsChangedEmailsJobResult> {
	return retryPersonalDetailsChangedEmails({ clock: systemClock });
}
