"use client";

import { useTranslate } from "@tolgee/react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	resetEmailTemplate,
	saveEmailTemplate,
	sendEmailTemplateTest,
} from "@/app/[locale]/(app)/settings/enterprise/email/template-actions";
import type {
	EmailTemplateEditorDocument,
	EmailTemplateKey,
} from "@/db/schema";
import type { EmailTemplateDefinition } from "@/lib/email/template-registry";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { useRouter } from "@/navigation";
import { getEmailTemplateCopy } from "./email-template-copy";
import type { EmailTemplateEditorHandle } from "./email-template-editor";

export interface EmailTemplateOverride {
	subject: string;
	editorDocument: EmailTemplateEditorDocument;
	html: string;
	plainText: string | null;
	isEnabled: boolean;
}

export interface EmailTemplateSettingsTemplate {
	definition: Omit<EmailTemplateDefinition, "renderDefault"> & {
		starterDraftHtml: string;
		starterDraftPlainText: string;
	};
	override: EmailTemplateOverride | null;
}

export type EmailTemplateAction = "save" | "sendTest" | "reset";

export type EmailTemplateDraft = {
	subject: string;
	html: string;
	plainText: string;
	editorDocument: EmailTemplateEditorDocument;
};

const createDraft = ({
	definition,
	override,
}: EmailTemplateSettingsTemplate): EmailTemplateDraft => ({
	subject: override?.subject ?? definition.defaultSubject,
	html: override?.html ?? definition.starterDraftHtml,
	plainText: override?.plainText ?? definition.starterDraftPlainText,
	editorDocument: override?.editorDocument ?? {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text: definition.starterDraftPlainText }],
			},
		],
	},
});

const hasUnchangedDefaultStarterBody = (
	template: EmailTemplateSettingsTemplate,
	draft: EmailTemplateDraft,
) =>
	!template.override &&
	draft.html === template.definition.starterDraftHtml &&
	draft.plainText === template.definition.starterDraftPlainText;

/**
 * Owns the per-template drafts, which templates carry an override, and the
 * save / send-test / reset actions for the selected template.
 */
export function useEmailTemplateSettings(
	templates: EmailTemplateSettingsTemplate[],
) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const editorRef = useRef<EmailTemplateEditorHandle>(null);
	const [isPending, startTransition] = useTransition();
	// Which action the pending transition belongs to, for its progress indicator.
	const [activeAction, setActiveAction] = useState<EmailTemplateAction | null>(
		null,
	);
	const [selectedKey, setSelectedKey] = useState<EmailTemplateKey | null>(
		templates[0]?.definition.key ?? null,
	);
	const [drafts, setDrafts] = useState<Record<string, EmailTemplateDraft>>(() =>
		Object.fromEntries(
			templates.map((template) => [
				template.definition.key,
				createDraft(template),
			]),
		),
	);
	const [overrideKeys, setOverrideKeys] = useState<Set<EmailTemplateKey>>(
		() =>
			new Set(
				templates.flatMap((template) =>
					template.override ? [template.definition.key] : [],
				),
			),
	);

	const templateCopy = getEmailTemplateCopy(t);
	const effectiveTemplates = templates.map((template) => ({
		...template,
		definition: {
			...template.definition,
			...templateCopy[template.definition.key],
		},
		override: overrideKeys.has(template.definition.key)
			? template.override
			: null,
	}));
	const selectedTemplate =
		effectiveTemplates.find(
			(template) => template.definition.key === selectedKey,
		) ?? null;
	const draft = selectedKey ? drafts[selectedKey] : null;
	const isCustomized = selectedKey !== null && overrideKeys.has(selectedKey);

	const updateDraft = (partial: Partial<EmailTemplateDraft>) => {
		if (!selectedKey) {
			return;
		}
		setDrafts((current) => ({
			...current,
			[selectedKey]: { ...current[selectedKey], ...partial },
		}));
	};

	const actionInput = () => {
		if (!selectedTemplate || !draft) {
			return null;
		}

		return {
			templateKey: selectedTemplate.definition.key,
			subject: draft.subject,
			html: draft.html,
			plainText: draft.plainText,
			editorDocument: draft.editorDocument,
		};
	};

	const handleSave = () => {
		if (
			selectedTemplate &&
			draft &&
			hasUnchangedDefaultStarterBody(selectedTemplate, draft)
		) {
			toast.error(
				t(
					"settings.emailTemplates.editBodyBeforeSaving",
					"Edit the email body before saving a first custom template.",
				),
			);
			return;
		}

		const input = actionInput();
		if (!input) {
			return;
		}

		setActiveAction("save");
		startTransition(async () => {
			const result = await saveEmailTemplate(input);
			if (result.success) {
				setOverrideKeys((current) => new Set(current).add(input.templateKey));
				toast.success(
					t("settings.emailTemplates.saved", "Email template saved"),
				);
				refresh();
				return;
			}
			toast.error(
				actionErrorMessage(t, result, {}, [
					"settings.emailTemplates.saveFailed",
					"Failed to save email template",
				]),
			);
		});
	};

	const handleSendTest = () => {
		const input = actionInput();
		if (!input) {
			return;
		}

		setActiveAction("sendTest");
		startTransition(async () => {
			const result = await sendEmailTemplateTest(input);
			if (result.success) {
				toast.success(
					t(
						"settings.emailTemplates.testSent",
						"Test email sent to your account",
					),
				);
				return;
			}
			toast.error(
				actionErrorMessage(t, result, {}, [
					"settings.emailTemplates.testFailed",
					"Failed to send test email",
				]),
			);
		});
	};

	/**
	 * Resets the selected template; resolves to the worded failure, shown inside the
	 * reset confirmation, or null once the template uses the system copy again.
	 */
	const handleReset = () =>
		new Promise<string | null>((resolve) => {
			if (!selectedTemplate) {
				resolve(null);
				return;
			}

			setActiveAction("reset");
			startTransition(async () => {
				const result = await resetEmailTemplate(selectedTemplate.definition.key).catch(() => null);
				if (result?.success) {
					setOverrideKeys((current) => {
						const next = new Set(current);
						next.delete(selectedTemplate.definition.key);
						return next;
					});
					setDrafts((current) => ({
						...current,
						[selectedTemplate.definition.key]: createDraft({
							definition: selectedTemplate.definition,
							override: null,
						}),
					}));
					toast.success(
						t(
							"settings.emailTemplates.reset",
							"Email template reset to system template",
						),
					);
					refresh();
					resolve(null);
					return;
				}
				resolve(
					result
						? actionErrorMessage(t, result, {}, [
								"settings.emailTemplates.resetFailed",
								"Failed to reset email template",
							])
						: t("settings.emailTemplates.resetFailed", "Failed to reset email template"),
				);
			});
		});

	const handleInsertVariable = (name: string) => {
		const token = `{{${name}}}`;
		editorRef.current?.insertIntoBody(token);
	};

	return {
		editorRef,
		isPending,
		pendingAction: isPending ? activeAction : null,
		effectiveTemplates,
		selectedTemplate,
		draft,
		isCustomized,
		selectTemplate: (key: string) => setSelectedKey(key as EmailTemplateKey),
		updateDraft,
		handleSave,
		handleSendTest,
		handleReset,
		handleInsertVariable,
	};
}
