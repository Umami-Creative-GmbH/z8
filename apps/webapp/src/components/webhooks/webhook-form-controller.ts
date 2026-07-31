import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	createWebhook,
	updateWebhook,
} from "@/app/[locale]/(app)/settings/webhooks/actions";
import type {
	PublicWebhookEndpoint,
	WebhookEndpoint,
} from "@/lib/webhooks/types";
import { useRouter } from "@/navigation";
import { EVENT_CATEGORIES } from "./webhook-event-categories";

export interface WebhookFormDialogProps {
	organizationId: string;
	webhook?: PublicWebhookEndpoint;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: (webhook: WebhookEndpoint) => void;
}

interface WebhookFormOperation {
	id: number;
	webhookIdentity: string;
}

function getWebhookFormDefaults(webhook?: PublicWebhookEndpoint) {
	return {
		name: webhook?.name ?? "",
		url: webhook?.url ?? "",
		description: webhook?.description ?? "",
		selectedEvents: [...((webhook?.subscribedEvents as string[]) ?? [])],
	};
}

export function useWebhookFormController({
	organizationId,
	webhook,
	webhookIdentity,
	onOpenChange,
	onSuccess,
}: WebhookFormDialogProps & { webhookIdentity: string }) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [isPending, startTransition] = useTransition();
	const nextOperationIdRef = useRef(0);
	const activeOperationRef = useRef<WebhookFormOperation | null>(null);
	const isEditing = !!webhook;
	const nameRequiredMessage = t(
		"webhooks:webhooks.form.name-required",
		"Name is required",
	);
	const urlRequiredMessage = t(
		"webhooks:webhooks.form.url-required",
		"URL is required",
	);
	const eventsRequiredMessage = t(
		"webhooks:webhooks.form.events-required",
		"At least one event must be selected",
	);
	const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
		() => new Set(Object.keys(EVENT_CATEGORIES)),
	);
	const [newSecret, setNewSecret] = useState<string | null>(null);
	const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false);

	function completeOperation(operation: WebhookFormOperation) {
		if (
			activeOperationRef.current?.id !== operation.id ||
			operation.webhookIdentity !== webhookIdentity
		)
			return false;
		activeOperationRef.current = null;
		return true;
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen && activeOperationRef.current) return;
		if (!nextOpen) form.reset(getWebhookFormDefaults(webhook));
		onOpenChange(nextOpen);
	}

	const form = useForm({
		defaultValues: getWebhookFormDefaults(webhook),
		onSubmitInvalid: ({ formApi }) => {
			activeOperationRef.current = null;
			for (const fieldName of ["name", "url", "selectedEvents"] as const) {
				const error = formApi
					.getFieldMeta(fieldName)
					?.errors.find((item): item is string => typeof item === "string");
				if (error) {
					toast.error(error);
					return;
				}
			}
		},
		onSubmit: async ({ value }) => {
			const operation = activeOperationRef.current;
			if (!operation) return;
			if (isEditing) {
				let result: Awaited<ReturnType<typeof updateWebhook>>;
				try {
					result = await updateWebhook(webhook.id, {
						name: value.name.trim(),
						url: value.url.trim(),
						description: value.description.trim() || undefined,
						subscribedEvents: value.selectedEvents,
					});
				} catch {
					if (!completeOperation(operation)) return;
					toast.error(
						t("webhooks:webhooks.update-failed", "Failed to update webhook"),
					);
					return;
				}
				if (!completeOperation(operation)) return;
				if (result.success) {
					onSuccess(result.data.endpoint);
					toast.success(t("webhooks:webhooks.updated", "Webhook updated"));
					handleOpenChange(false);
					startTransition(() => refresh());
				} else {
					toast.error(
						result.error ??
							t("webhooks:webhooks.update-failed", "Failed to update webhook"),
					);
				}
			} else {
				let result: Awaited<ReturnType<typeof createWebhook>>;
				try {
					result = await createWebhook({
						organizationId,
						name: value.name.trim(),
						url: value.url.trim(),
						description: value.description.trim() || undefined,
						subscribedEvents: value.selectedEvents,
					});
				} catch {
					if (!completeOperation(operation)) return;
					toast.error(
						t("webhooks:webhooks.create-failed", "Failed to create webhook"),
					);
					return;
				}
				if (!completeOperation(operation)) return;
				if (result.success) {
					onSuccess(result.data.endpoint);
					setNewSecret(result.data.secret);
					setIsSecretDialogOpen(true);
					handleOpenChange(false);
					startTransition(() => refresh());
				} else {
					toast.error(
						result.error ??
							t("webhooks:webhooks.create-failed", "Failed to create webhook"),
					);
				}
			}
		},
	});

	useLayoutEffect(
		() => () => {
			activeOperationRef.current = null;
		},
		[],
	);

	return {
		activeOperationRef,
		allEvents: Object.values(EVENT_CATEGORIES).flatMap((category) => [
			...category.events,
		]),
		eventsRequiredMessage,
		expandedCategories,
		form,
		handleOpenChange,
		isEditing,
		isPending,
		isSecretDialogOpen,
		nameRequiredMessage,
		newSecret,
		nextOperationIdRef,
		setExpandedCategories,
		setIsSecretDialogOpen,
		setNewSecret,
		t,
		urlRequiredMessage,
	};
}

export type WebhookFormController = ReturnType<typeof useWebhookFormController>;
