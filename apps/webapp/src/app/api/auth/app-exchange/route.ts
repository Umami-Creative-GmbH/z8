import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeAppAuthCode, type SupportedApp } from "@/lib/auth/app-auth-code";

const bodySchema = z.object({ code: z.string().trim().min(1) });

function resolveAppType(request: Request): SupportedApp | null {
	const appType = request.headers.get("x-z8-app-type")?.toLowerCase();

	return appType === "mobile" || appType === "desktop" ? appType : null;
}

export async function POST(request: Request) {
	const app = resolveAppType(request);
	if (!app) {
		return NextResponse.json({ error: "Supported app type required" }, { status: 400 });
	}

	const body = await request.json().catch(() => null);
	const parsed = bodySchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Code is required" }, { status: 400 });
	}

	const result = await consumeAppAuthCode({ app, code: parsed.data.code });
	if (result.status !== "success") {
		return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
	}

	return NextResponse.json({ token: result.sessionToken });
}
