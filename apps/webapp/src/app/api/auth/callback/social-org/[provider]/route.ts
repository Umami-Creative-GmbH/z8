import { auth } from "@/lib/auth";

// Dispatch through Better Auth so custom OAuth uses the same session lifecycle
// and signed-cookie handling as the built-in providers.
export async function GET(request: Request) {
	return auth.handler(request);
}

export async function POST(request: Request) {
	return auth.handler(request);
}
