import { env } from "@/env";
import document from "../../../../../openapi/public-api-v1.json";

/** GET /api/v1/openapi.json: public, installation-targeted contract download. */
export function GET(request: Request) {
	const requestUrl = new URL(request.url);
	// Operator configuration preserves the public origin behind reverse proxies,
	// where Next.js may see its internal listening address. Never use the docs host.
	const origin = new URL(
		env.APP_URL || env.BETTER_AUTH_URL || env.NEXT_PUBLIC_APP_URL || requestUrl.origin,
	).origin;
	return Response.json(
		{
			...document,
			servers: [{ url: origin, description: "This Z8 installation" }],
		},
		{
			headers: {
				"Cache-Control": "no-store",
				"Content-Disposition": 'attachment; filename="z8-public-api-v1.openapi.json"',
			},
		},
	);
}
