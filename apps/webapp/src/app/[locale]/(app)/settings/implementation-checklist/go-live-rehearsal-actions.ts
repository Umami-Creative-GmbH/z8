"use server";

import { db } from "@/db";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import { rehearseGoLiveMember } from "@/lib/implementation-checklist/go-live/rehearsal";
import type { GoLiveRehearsalActionResult } from "@/lib/implementation-checklist/go-live/rehearsal-types";
import { createLogger } from "@/lib/logger";
import { loadGoLiveViewer } from "./queries";

const logger = createLogger("GoLiveRehearsal");

/** Longer than any `goLiveMemberKey` ("employee:" or "invitee:" and a uuid). */
const MEMBER_KEY_MAX_LENGTH = 200;

/**
 * The go-live rehearsal for one checked member of the caller's organization, as of now. Org
 * admins only; the organization comes from the session, and a member outside its go-live group
 * (former, excluded, another organization's, unknown) is refused. Nothing is written.
 */
export async function rehearseGoLiveMemberAction(
	memberKey: string,
): Promise<GoLiveRehearsalActionResult> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	if (typeof memberKey !== "string" || memberKey.length > MEMBER_KEY_MAX_LENGTH) {
		return { success: false, error: "member_not_checked" };
	}

	try {
		const { asOf, fixLink } = await loadGoLiveViewer(organizationId, systemClock.nowInstant());
		const result = await rehearseGoLiveMember(db, { organizationId, asOf, memberKey, fixLink });
		return result.ok
			? { success: true, data: result.rehearsal }
			: { success: false, error: result.refusal };
	} catch (error) {
		logger.error({ organizationId, error }, "Go-live rehearsal lookup failed");
		return { success: false, error: "unavailable" };
	}
}
