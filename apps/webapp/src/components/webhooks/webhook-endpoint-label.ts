import type { PublicWebhookEndpoint } from "@/lib/webhooks/types";

const ENDPOINT_LABEL_URL_LENGTH = 48;

/** Identifies an endpoint in control names: its name, or a shortened URL when it has none. */
export function webhookEndpointLabel(webhook: Pick<PublicWebhookEndpoint, "name" | "url">) {
	const name = webhook.name.trim();
	if (name) return name;
	const url = webhook.url.replace(/^https?:\/\//, "");
	return url.length > ENDPOINT_LABEL_URL_LENGTH
		? `${url.slice(0, ENDPOINT_LABEL_URL_LENGTH - 1)}…`
		: url;
}
