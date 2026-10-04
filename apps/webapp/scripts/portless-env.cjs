// Load before Next.js reads .env files or starts workers. Portless owns the
// public development origin; Phase may still supply the old localhost URL.
if (process.env.PORTLESS_URL && process.env.PORTLESS !== "0") {
	const url = new URL(process.env.PORTLESS_URL);
	process.env.APP_URL = url.origin;
	process.env.BETTER_AUTH_URL = url.origin;
	process.env.NEXT_PUBLIC_APP_URL = url.origin;
	process.env.MAIN_DOMAIN = url.hostname;
	process.env.PLATFORM_DOMAIN = url.hostname;
	process.env.PASSKEY_RP_ID = url.hostname;
}
