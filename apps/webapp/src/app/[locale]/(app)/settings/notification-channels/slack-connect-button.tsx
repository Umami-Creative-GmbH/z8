"use client";

import { IconBrandSlack, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const SLACK_AUTHORIZE_ORIGIN = "https://slack.com";

function navigateToSlack(url: string) {
	window.location.assign(url);
}

/** Only ever leave the app for Slack's own authorization page. */
function slackAuthorizeUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		return url.origin === SLACK_AUTHORIZE_ORIGIN ? url.toString() : null;
	} catch {
		return null;
	}
}

/**
 * Starts the Slack install flow: the authorize route records a state token
 * for this organization (it re-checks the admin role) and returns Slack's
 * authorization URL.
 */
export function SlackConnectButton({
	organizationId,
	navigate = navigateToSlack,
}: {
	organizationId: string;
	/** Leaves for Slack; replaceable in tests. */
	navigate?: (url: string) => void;
}) {
	const { t } = useTranslate();
	const [isStarting, setIsStarting] = useState(false);

	async function startConnect() {
		if (isStarting) return;
		setIsStarting(true);
		try {
			const response = await fetch("/api/slack/oauth/authorize", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ organizationId }),
			});
			const body: unknown = response.ok ? await response.json() : null;
			const authUrl =
				body && typeof body === "object" && "authUrl" in body
					? slackAuthorizeUrl(body.authUrl)
					: null;
			if (authUrl) {
				// Keep the pending state while the browser leaves for Slack.
				navigate(authUrl);
				return;
			}
			toast.error(
				response.status === 503
					? t(
							"settings.notifications.slack.connectUnavailable",
							"Slack is not available on this Z8 installation.",
						)
					: t(
							"settings.notifications.slack.connectFailed",
							"Slack connection could not be started. Try again.",
						),
			);
		} catch {
			toast.error(
				t(
					"settings.notifications.slack.connectFailed",
					"Slack connection could not be started. Try again.",
				),
			);
		}
		setIsStarting(false);
	}

	return (
		<Button type="button" onClick={startConnect} disabled={isStarting}>
			{isStarting ? (
				<IconLoader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden="true" />
			) : (
				<IconBrandSlack className="mr-2 size-4" aria-hidden="true" />
			)}
			{t("settings.notifications.slack.connect", "Connect Slack")}
		</Button>
	);
}
