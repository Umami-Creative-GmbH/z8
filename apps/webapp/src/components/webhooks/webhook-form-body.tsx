import { IconLoader2 } from "@tabler/icons-react";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import {
	useWebhookFormController,
	type WebhookFormDialogProps,
} from "./webhook-form-controller";
import { WebhookBasicFields, WebhookEventFields } from "./webhook-form-fields";
import { WebhookSecretDialog } from "./webhook-secret-dialog";

export function WebhookFormBody(
	props: WebhookFormDialogProps & { webhookIdentity: string },
) {
	const { open, webhookIdentity } = props;
	const controller = useWebhookFormController(props);
	const {
		activeOperationRef,
		form,
		handleOpenChange,
		isEditing,
		isPending,
		isSecretDialogOpen,
		newSecret,
		nextOperationIdRef,
		setIsSecretDialogOpen,
		setNewSecret,
		t,
	} = controller;
	return (
		<>
			<ActionPanel open={open} onOpenChange={handleOpenChange}>
				<ActionPanelContent size="wide">
					<ActionPanelHeader>
						<ActionPanelTitle>
							{isEditing
								? t("webhooks:webhooks.form.edit-title", "Edit Webhook")
								: t("webhooks:webhooks.form.create-title", "Create Webhook")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{isEditing
								? t(
										"webhooks:webhooks.form.edit-description",
										"Update the webhook endpoint configuration.",
									)
								: t(
										"webhooks:webhooks.form.create-description",
										"Configure a new webhook endpoint to receive event notifications.",
									)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							if (activeOperationRef.current) return;
							activeOperationRef.current = {
								id: ++nextOperationIdRef.current,
								webhookIdentity,
							};
							void form.handleSubmit();
						}}
						className="flex min-h-0 flex-1 flex-col"
					>
						<ActionPanelBody className="space-y-6">
							<WebhookBasicFields controller={controller} />
							<WebhookEventFields controller={controller} />
						</ActionPanelBody>
						<ActionPanelFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => handleOpenChange(false)}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
								{(isSubmitting: boolean) => (
									<Button type="submit" disabled={isSubmitting || isPending}>
										{isSubmitting || isPending ? (
											<IconLoader2
												className="mr-2 size-4 animate-spin"
												aria-hidden="true"
											/>
										) : null}
										{isEditing
											? t("common.save", "Save")
											: t("webhooks:webhooks.form.create", "Create Webhook")}
									</Button>
								)}
							</form.Subscribe>
						</ActionPanelFooter>
					</form>
				</ActionPanelContent>
			</ActionPanel>
			<WebhookSecretDialog
				secret={newSecret}
				open={isSecretDialogOpen}
				onOpenChange={(nextOpen) => {
					setIsSecretDialogOpen(nextOpen);
					if (!nextOpen) setNewSecret(null);
				}}
			/>
		</>
	);
}
