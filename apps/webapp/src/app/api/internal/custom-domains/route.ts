import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { organizationDomain } from "@/db/schema/enterprise";
import { env } from "@/env";
import { isValidCronAuthorization } from "@/lib/cron/auth";
import { normalizeCustomDomain } from "@/lib/domain/custom-domain-hostname";

// Next 16.4.6 dist/server/base-server.js fills x-forwarded-{host,port,proto,for}
// on direct requests too (for comes from socket.remoteAddress). Only Traefik
// adds x-real-ip, so its presence, even with an empty value, identifies ingress.
function cameThroughIngress(request: Request) {
	return request.headers.has("x-real-ip");
}

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
	// Cache Components uses connection() for request-time execution on Node.
	await connection();
	if (cameThroughIngress(request)) return new Response(null, { status: 404, headers: noStore });
	if (!isValidCronAuthorization(request.headers.get("authorization"), env.CRON_SECRET)) {
		return new Response(null, { status: 401, headers: noStore });
	}

	try {
		const rows = await db
			.select({ domain: organizationDomain.domain })
			.from(organizationDomain)
			.where(eq(organizationDomain.domainVerified, true));
		const domains = [...new Set(rows.map(({ domain }) => normalizeCustomDomain(domain)))].sort();
		return Response.json({ domains }, { headers: noStore });
	} catch {
		// A partial or empty success would tell the reconciler to delete live routes.
		return new Response(null, { status: 500, headers: noStore });
	}
}

function methodNotAllowed(request: Request) {
	if (cameThroughIngress(request)) return new Response(null, { status: 404, headers: noStore });
	return new Response(null, { status: 405, headers: { ...noStore, Allow: "GET" } });
}

// Explicitly override Next's automatic HEAD and OPTIONS responses as well.
export {
	methodNotAllowed as POST,
	methodNotAllowed as PUT,
	methodNotAllowed as PATCH,
	methodNotAllowed as DELETE,
	methodNotAllowed as HEAD,
	methodNotAllowed as OPTIONS,
};
