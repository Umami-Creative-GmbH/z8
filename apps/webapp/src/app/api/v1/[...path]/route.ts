import { problem, problemResponse } from "@/lib/public-api/problem";

/** Any other /api/v1 path: a problem+json 404, never an HTML page. */
function notFound() {
	return problemResponse(
		problem("not_found", { detail: "No Public API v1 endpoint has this path." }),
	);
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
