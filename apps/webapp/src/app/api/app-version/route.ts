import { env } from "@/env";

const CACHE_HEADERS = {
	"cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
	expires: "0",
	pragma: "no-cache",
};

export function GET() {
	return Response.json(
		{ buildHash: env.NEXT_PUBLIC_BUILD_HASH ?? "development" },
		{ headers: CACHE_HEADERS },
	);
}
