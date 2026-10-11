import "server-only";

/**
 * The UI language of a share link's creator, for a recipient whose browser
 * language Z8 lacks (#806). Null for any token that opens no link, so the
 * page language never tells an unknown token from a known one.
 */
export async function shareLinkCreatorLocaleForToken(token: string): Promise<string | null> {
	const [{ db }, { shareLinkCreatorLocale }] = await Promise.all([
		import("@/db"),
		import("./report-share-links"),
	]);
	return shareLinkCreatorLocale(db, token);
}
