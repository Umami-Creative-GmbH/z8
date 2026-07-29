"use client";

import { WebhookFormBody } from "./webhook-form-body";
import type { WebhookFormDialogProps } from "./webhook-form-controller";

export function WebhookFormDialog(props: WebhookFormDialogProps) {
	const webhookIdentity = props.webhook?.id ?? "create";
	return (
		<WebhookFormDialogForm
			key={webhookIdentity}
			{...props}
			webhookIdentity={webhookIdentity}
		/>
	);
}

function WebhookFormDialogForm(
	props: WebhookFormDialogProps & { webhookIdentity: string },
) {
	return <WebhookFormBody {...props} />;
}
