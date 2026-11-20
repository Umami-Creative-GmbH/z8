import { isIP } from "node:net";
import { z } from "zod";

const hostname = z.hostname();

export function normalizeCustomDomain(value: string): string {
	const domain = value.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
	if (
		!domain.includes(".") ||
		domain.endsWith(".") ||
		isIP(domain) ||
		!hostname.safeParse(domain).success
	) {
		throw new Error("Invalid custom domain hostname");
	}
	return domain;
}
