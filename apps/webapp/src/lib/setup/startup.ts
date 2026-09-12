import "server-only";
import { env } from "@/env";

export async function initializeSetupOnStartup(): Promise<void> {
	if (
		process.env.NEXT_PHASE === "phase-production-build" ||
		process.env.npm_lifecycle_event === "build"
	)
		return;
	const { setupBootstrap, hasPlatformAdmin } = await import(
		"./bootstrap.server"
	);
	const bootstrap = await setupBootstrap.initialize();
	if (!bootstrap) return;

	// A different replica may have finished setup while this replica was starting.
	if (await hasPlatformAdmin()) {
		await setupBootstrap.invalidate();
		return;
	}

	const baseUrl =
		env.APP_URL ||
		env.BETTER_AUTH_URL ||
		env.NEXT_PUBLIC_APP_URL ||
		(env.PLATFORM_DOMAIN || env.MAIN_DOMAIN
			? `https://${env.PLATFORM_DOMAIN || env.MAIN_DOMAIN}`
			: "http://localhost:3000");
	const url = new URL("/setup", baseUrl);
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password
	) {
		throw new Error("Setup requires a valid application URL");
	}
	url.searchParams.set("code", bootstrap.code);
	// Deliberate operator-only secret output. Do not send this to the application logger/analytics.
	console.log(
		`[Setup] Setup code: ${bootstrap.code}\n[Setup] Open: ${url.href}\n[Setup] Expires in ${bootstrap.remainingSeconds} seconds (original one-hour window).${bootstrap.exchanged ? "\n[Setup] This code was already exchanged. Continue in the authorized browser. If its session expired, wait for this window to expire and restart the server." : ""}`,
	);
}
