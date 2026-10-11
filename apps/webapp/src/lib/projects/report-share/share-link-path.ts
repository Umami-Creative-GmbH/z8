/**
 * The path of a report share link (#806): `/share/<token>`, without a locale,
 * so the recipient page picks the recipient's language. Client- and
 * proxy-safe.
 */

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The path a recipient opens; the creator copies it once. */
export function shareLinkPath(token: string): string {
	return `/share/${token}`;
}

/**
 * Any share page path, with or without a locale prefix, as logs and telemetry
 * must not record it: the token is a credential.
 */
export const SHARE_REQUEST_PATH = /\/(?:[a-z]{2,3}\/)?share\/[^/?#]+/;
