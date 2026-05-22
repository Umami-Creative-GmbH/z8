import { classifyDomainHost } from "./platform-domain";

export function getCustomDomainFromHeaders(headers: Headers): string | null {
	const classification = classifyDomainHost(headers.get("host"));
	return classification?.type === "customDomain" ? classification.hostname : null;
}
