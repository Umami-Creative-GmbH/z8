"use client";

import { useTranslate } from "@tolgee/react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	resetEmailTemplate,
	saveEmailTemplate,
	sendEmailTemplateTest,
} from "@/app/[locale]/(app)/settings/email-templates/actions";
import type {
	EmailTemplateEditorDocument,
	EmailTemplateKey,
} from "@/db/schema";
import type { EmailTemplateDefinition } from "@/lib/email/template-registry";
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
				result.errors?.join("\n") ??
					t(
						"settings.emailTemplates.saveFailed",
						"Failed to save email template",
					),
			);
		});
	};

	const handleSendTest = () => {
		const input = actionInput();
		if (!input) {
			return;
		}

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
				result.errors?.join("\n") ??
					t("settings.emailTemplates.testFailed", "Failed to send test email"),
			);
		});
	};

	const handleReset = () => {
		if (!selectedTemplate) {
			return;
		}

		startTransition(async () => {
			const result = await resetEmailTemplate(selectedTemplate.definition.key);
			if (result.success) {
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
				return;
			}
			toast.error(
				result.errors?.join("\n") ??
					t(
						"settings.emailTemplates.resetFailed",
						"Failed to reset email template",
					),
			);
		});
	};

	const handleInsertVariable = (name: string) => {
		const token = `{{${name}}}`;
		editorRef.current?.insertIntoBody(token);
	};

	return {
		editorRef,
		isPending,
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
