import { eq } from "drizzle-orm";
import { NextResponse, connection } from "next/server";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { resolvePublicRequestOrigin } from "@/lib/domain/request-origin";
import { canAccessOrganizationWithSso } from "@/lib/enterprise-identity/session-sso-store";
import {
	ClockingAccessError,
	clockingService,
} from "@/lib/time-tracking/clocking-service";
const paths = {
	time: "/time-tracking",
	reports: "/reports",
	preferences: "/settings/profile",
} as const;
function escape(value: string) {
	return value.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			] ?? char,
	);
}
async function handoff(request: Request) {
	const url = new URL(request.url);
	const organizationId = url.searchParams.get("organizationId"),
		userId = url.searchParams.get("userId");
	const section = url.searchParams.get("section"),
		language = url.searchParams.get("language") === "de" ? "de" : "en";
	if (
		!organizationId ||
		!userId ||
		(section !== "time" && section !== "reports" && section !== "preferences")
	)
		return {
			response: NextResponse.json(
				{ error: "Invalid desktop destination" },
				{ status: 400 },
			),
		};
	const origin = await resolvePublicRequestOrigin(request);
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user) {
		const login = new URL(`/${language}/sign-in`, origin);
		login.searchParams.set("callbackUrl", `${url.pathname}${url.search}`);
		return { response: NextResponse.redirect(login, 303) };
	}
	if (session.user.id !== userId)
		return {
			response: new Response(
				language === "de"
					? "Ihr Browser ist mit einem anderen Z8-Konto angemeldet. Melden Sie sich mit dem Konto der Desktop-App an und öffnen Sie den Link erneut."
					: "Your browser is signed into a different Z8 account. Sign in with the desktop app's account, then open this link again.",
				{
					status: 409,
					headers: { "Content-Type": "text/plain; charset=utf-8" },
				},
			),
		};
	if (!(await canAccessOrganizationWithSso(session.session, organizationId)))
		return {
			response: NextResponse.json(
				{ error: "Organization SSO required" },
				{ status: 403 },
			),
		};
	await clockingService.requireActor({
		userId,
		activeOrganizationId: organizationId,
	});
	return {
		organizationId,
		section,
		destination: paths[section],
		language,
		origin,
	};
}
/** A browser cookie may belong to another account or organization. Show the
 * destination and require a browser gesture before switching its context. */
export async function GET(request: Request) {
	await connection();
	try {
		const target = await handoff(request);
		if (target.response) return target.response;
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, target.organizationId),
			columns: { name: true },
		});
		const name = escape(org?.name ?? target.organizationId);
		const heading =
			target.language === "de"
				? "Z8 in der richtigen Organisation öffnen"
				: "Open Z8 in the selected organization";
		const button =
			target.language === "de"
				? "Organisation bestätigen und öffnen"
				: "Confirm organization and open";
		return new Response(
			`<!doctype html><html lang="${target.language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title><style>body{font:16px system-ui;background:#f5f6fa;color:#172032;display:grid;min-height:90vh;place-content:center;padding:24px}main{max-width:440px}h1{font-size:24px}button{font:inherit;background:#4338a8;color:white;border:0;border-radius:8px;padding:12px 20px;cursor:pointer}button:focus-visible{outline:3px solid #172032;outline-offset:4px}</style><main><h1>${heading}</h1><p>${name}</p><form method="post"><button type="submit">${button}</button></form></main></html>`,
			{
				headers: {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "private, no-store",
					"Content-Security-Policy":
						"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
				},
			},
		);
	} catch (error) {
		return NextResponse.json(
			{ error: "Desktop destination unavailable" },
			{ status: error instanceof ClockingAccessError ? 403 : 500 },
		);
	}
}
export async function POST(request: Request) {
	await connection();
	try {
		const target = await handoff(request);
		if (target.response) return target.response;
		if (request.headers.get("origin") !== target.origin)
			return NextResponse.json(
				{ error: "Same-origin confirmation required" },
				{ status: 403 },
			);
		const switched = await auth.api.setActiveOrganization({
			headers: request.headers,
			body: { organizationId: target.organizationId },
			asResponse: true,
		});
		if (!switched.ok)
			return NextResponse.json(
				{ error: "Organization switch refused" },
				{ status: 403 },
			);
		const response = NextResponse.redirect(
			new URL(`/${target.language}${target.destination}`, target.origin),
			303,
		);
		for (const cookie of switched.headers.getSetCookie())
			response.headers.append("Set-Cookie", cookie);
		return response;
	} catch (error) {
		return NextResponse.json(
			{ error: "Desktop destination unavailable" },
			{ status: error instanceof ClockingAccessError ? 403 : 500 },
		);
	}
}
