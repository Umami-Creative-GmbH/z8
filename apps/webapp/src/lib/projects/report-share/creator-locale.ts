import "server-only";

import { systemClock } from "@/lib/datetime/temporal-core";

/**
 * The UI language of a live share link's creator, for a recipient whose
 * browser language Z8 lacks (#806). Null for any token that opens no link, so
 * the page language never tells an unknown token from an expired or revoked one.
 */
export async function shareLinkCreatorLocaleForToken(token: string): Promise<string | null> {
	const [{ db }, { shareLinkCreatorLocale }] = await Promise.all([
		import("@/db"),
		import("./report-share-links"),
	]);
	return shareLinkCreatorLocale(db, token, systemClock.nowInstant());
}
