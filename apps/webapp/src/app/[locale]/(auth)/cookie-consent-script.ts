import type { DomainAuthContext } from "@/lib/domain";

export type CookieConsentScriptConfig = {
	id?: string;
	src?: string;
	content?: string;
	type?: string;
	async?: boolean;
	defer?: boolean;
} & Record<`data-${string}`, string>;

export function selectAuthCookieConsentScript(
	domainContext: DomainAuthContext | null,
	platformCookieConsentScript: string | null,
): string | null {
	if (!domainContext?.domain) {
		return normalizeScript(platformCookieConsentScript);
	}

	return normalizeScript(getDomainCookieConsentScript(domainContext));
}

function getDomainCookieConsentScript(domainContext: DomainAuthContext): string | null {
	return domainContext.authConfig.cookieConsentScript ?? null;
}

function normalizeScript(script: string | null): string | null {
	if (!script || script.trim().length === 0) {
		return null;
	}

	return script;
}

export function parseCookieConsentScript(script: string | null): CookieConsentScriptConfig | null {
	const normalizedScript = normalizeScript(script);
	if (!normalizedScript) {
		return null;
	}

	const scriptTagMatch = normalizedScript.match(/^\s*<script\b([^>]*)>([\s\S]*)<\/script>\s*$/i);
	if (!scriptTagMatch) {
		return { content: normalizedScript };
	}

	const attrs = parseScriptAttributes(scriptTagMatch[1] ?? "");
	const config: CookieConsentScriptConfig = {};

	for (const [name, value] of Object.entries(attrs)) {
		if (name === "id" || name === "src" || name === "type") {
			config[name] = value;
		} else if (name === "async" || name === "defer") {
			config[name] = true;
		} else if (name.startsWith("data-") && value) {
			config[name as `data-${string}`] = value;
		}
	}

	if (!config.src) {
		config.content = scriptTagMatch[2] ?? "";
	}

	return config;
}

function parseScriptAttributes(attributes: string): Record<string, string> {
	const result: Record<string, string> = {};
	const attributePattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

	for (const match of attributes.matchAll(attributePattern)) {
		const name = match[1]?.toLowerCase();
		if (!name) {
			continue;
		}

		result[name] = match[2] ?? match[3] ?? match[4] ?? "";
	}

	return result;
}
