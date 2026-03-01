"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCookieConsentScript, setCookieConsentScript } from "@/lib/platform-settings";

export async function getCookieConsentScriptAction(): Promise<{
	success: boolean;
	data?: string | null;
	error?: string;
}> {
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user || session.user.role !== "admin") {
		return { success: false, error: "Unauthorized" };
	}

	try {
		const script = await getCookieConsentScript();
		return { success: true, data: script };
	} catch (error) {
		console.error("Failed to get cookie consent script:", error);
		return { success: false, error: "Failed to fetch script" };
	}
}

export async function setCookieConsentScriptAction(
	script: string,
): Promise<{ success: boolean; error?: string }> {
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user || session.user.role !== "admin") {
		return { success: false, error: "Unauthorized" };
	}

	try {
		await setCookieConsentScript(script);
		return { success: true };
	} catch (error) {
		console.error("Failed to set cookie consent script:", error);
		return { success: false, error: "Failed to save script" };
	}
}
