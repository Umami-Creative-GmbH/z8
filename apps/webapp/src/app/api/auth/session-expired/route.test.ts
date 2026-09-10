import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";
import { GET } from "./route";

describe("session-expired redirects", () => {
	it.each(["/evil.example/#", "\\evil.example", "../..", "xx", "en\n", ""])(
		"falls back to the default locale for %j",
		async (locale) => {
			const url = new URL("https://app.example/api/auth/session-expired");
			url.searchParams.set("locale", locale);
			const response = await GET(new NextRequest(url));
			expect(response.headers.get("location")).toBe(
				`https://app.example/${DEFAULT_LANGUAGE}/sign-in`,
			);
		},
	);

	it.each(ALL_LANGUAGES)("preserves supported locale %s and clears cookies", async (locale) => {
		const url = new URL("https://app.example/api/auth/session-expired");
		url.searchParams.set("locale", locale);
		url.searchParams.set("callbackUrl", "/settings?tab=security");
		const response = await GET(new NextRequest(url));
		const redirect = new URL(response.headers.get("location")!);
		expect(redirect.origin).toBe(url.origin);
		expect(redirect.pathname).toBe(`/${locale}/sign-in`);
		expect(redirect.searchParams.get("callbackUrl")).toBe("/settings?tab=security");
		expect(response.cookies.get("better-auth.session_token")?.value).toBe("");
	});
});
