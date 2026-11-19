import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createWebhook, updateWebhook } from "@/app/[locale]/(app)/settings/webhooks/actions";
import type { PublicWebhookEndpoint, WebhookEndpoint } from "@/lib/webhooks/types";
import { useRouter } from "@/navigation";
import { EVENT_CATEGORIES } from "./webhook-event-categories";

export interface WebhookFormDialogProps {
	webhook?: PublicWebhookEndpoint;
	open: boolean;
	actionAvailable?: boolean;
	/** The live query may retire completion before its observer commits. */
	canComplete?: () => boolean;
	onOpenChange: (open: boolean) => void;
	/** A refused local snapshot can reject completion by returning false. */
	onSuccess: ((webhook: WebhookEndpoint) => void) | ((webhook: WebhookEndpoint) => boolean);
}

interface WebhookFormOperation {
	retired: boolean;
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
	webhook,
	webhookIdentity,
	actionAvailable = true,
	canComplete,
	onOpenChange,
	onSuccess,
}: WebhookFormDialogProps & { webhookIdentity: string }) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [refreshPending, startTransition] = useTransition();
	const [submitting, setSubmitting] = useState(false);
	const activeOperationRef = useRef<WebhookFormOperation | null>(null);
	const isEditing = !!webhook;
	const nameRequiredMessage = t("webhooks:webhooks.form.name-required", "Name is required");
	const urlRequiredMessage = t("webhooks:webhooks.form.url-required", "URL is required");
	const eventsRequiredMessage = t(
		"webhooks:webhooks.form.events-required",
		"At least one event must be selected",
	);
	const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
		() => new Set(Object.keys(EVENT_CATEGORIES)),
	);
	const [newSecret, setNewSecret] = useState<string | null>(null);

	function isCurrent(operation: WebhookFormOperation | null) {
		return (
			!!operation &&
			(canComplete?.() ?? true) &&
			!operation.retired &&
			activeOperationRef.current === operation &&
			operation.webhookIdentity === webhookIdentity
		);
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!actionAvailable || activeOperationRef.current) return;
		if (!nextOpen) form.reset(getWebhookFormDefaults(webhook));
		onOpenChange(nextOpen);
	}

	const form = useForm({
		defaultValues: getWebhookFormDefaults(webhook),
		onSubmitMeta: null as WebhookFormOperation | null,
		onSubmitInvalid: ({ formApi }) => {
			if (!isCurrent(activeOperationRef.current)) return;
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
		onSubmit: async ({ value, meta: operation }) => {
			if (!isCurrent(operation)) return;
			if (isEditing) {
				let result: Awaited<ReturnType<typeof updateWebhook>>;
				try {
					result = await updateWebhook({
						webhookId: webhook.id,
						name: value.name.trim(),
						url: value.url.trim(),
						description: value.description.trim() || undefined,
						subscribedEvents: value.selectedEvents,
					});
				} catch {
					if (!isCurrent(operation)) return;
					toast.error(t("webhooks:webhooks.update-failed", "Failed to update webhook"));
					return;
				}
				if (!isCurrent(operation)) return;
				if (result.success) {
					if (onSuccess(result.data.endpoint) === false) return;
					toast.success(t("webhooks:webhooks.updated", "Webhook updated"));
					form.reset(getWebhookFormDefaults(webhook));
					onOpenChange(false);
					startTransition(() => refresh());
				} else {
					toast.error(
						result.error ?? t("webhooks:webhooks.update-failed", "Failed to update webhook"),
					);
				}
			} else {
				let result: Awaited<ReturnType<typeof createWebhook>>;
				try {
					result = await createWebhook({
						name: value.name.trim(),
						url: value.url.trim(),
						description: value.description.trim() || undefined,
						subscribedEvents: value.selectedEvents,
					});
				} catch {
					if (!isCurrent(operation)) return;
					toast.error(t("webhooks:webhooks.create-failed", "Failed to create webhook"));
					return;
				}
				if (!isCurrent(operation)) return;
				if (result.success) {
					if (onSuccess(result.data.endpoint) === false) return;
					setNewSecret(result.data.secret);
					form.reset(getWebhookFormDefaults(webhook));
					onOpenChange(false);
					startTransition(() => refresh());
				} else {
					toast.error(
						result.error ?? t("webhooks:webhooks.create-failed", "Failed to create webhook"),
					);
				}
			}
		},
	});

	useLayoutEffect(() => {
		function retire() {
			if (activeOperationRef.current) activeOperationRef.current.retired = true;
			setNewSecret(null);
		}
		if (!actionAvailable) retire();
		return retire;
	}, [actionAvailable]);

	function submit() {
		if (!actionAvailable || activeOperationRef.current) return;
		// Retirement suppresses UI effects; a dispatched command still holds this lock until settlement.
		const operation: WebhookFormOperation = { webhookIdentity, retired: false };
		activeOperationRef.current = operation;
		setSubmitting(true);
		void form.handleSubmit(operation).finally(() => {
			if (activeOperationRef.current === operation) {
				activeOperationRef.current = null;
				setSubmitting(false);
			}
		});
	}

	return {
		allEvents: Object.values(EVENT_CATEGORIES).flatMap((category) => [...category.events]),
		eventsRequiredMessage,
		expandedCategories,
		form,
		handleOpenChange,
		isEditing,
		isPending: submitting || refreshPending,
		nameRequiredMessage,
		newSecret: actionAvailable ? newSecret : null,
		submit,
		setExpandedCategories,
		setNewSecret,
		t,
		urlRequiredMessage,
	};
}

export type WebhookFormController = ReturnType<typeof useWebhookFormController>;
