const SESSION_COOKIE_NAMES = [
	"better-auth.session-token",
	"better-auth.session_token",
	"better-auth.session_data",
] as const;

type HeaderReader = Pick<Headers, "get">;

function getCookieHeader(headers: HeaderReader): string {
	return headers.get("cookie") ?? "";
}

export function getAuthRequestDiagnostics(headers: HeaderReader) {
	const cookieHeader = getCookieHeader(headers);

	return {
		host: headers.get("host"),
		origin: headers.get("origin"),
		referer: headers.get("referer"),
		xForwardedHost: headers.get("x-forwarded-host"),
		xForwardedProto: headers.get("x-forwarded-proto"),
		xForwardedFor: headers.get("x-forwarded-for"),
		hasCookieHeader: cookieHeader.length > 0,
		sessionCookies: Object.fromEntries(
			SESSION_COOKIE_NAMES.map((cookieName) => [
				cookieName,
				cookieHeader.includes(`${cookieName}=`),
			]),
		),
	};
}
