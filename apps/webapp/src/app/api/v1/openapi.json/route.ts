import document from "../../../../../openapi/public-api-v1.json";

/** GET /api/v1/openapi.json: the committed Public API v1 OpenAPI document. Public. */
export function GET() {
	return Response.json(document, {
		headers: { "Cache-Control": "public, max-age=300" },
	});
}
