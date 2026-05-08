"use client";

import { useTranslate } from "@tolgee/react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	resetEmailTemplate,
	saveEmailTemplate,
	sendEmailTemplateTest,
} from "@/app/[locale]/(app)/settings/email-templates/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmailTemplateEditorDocument, EmailTemplateKey } from "@/db/schema";
import type { EmailTemplateDefinition } from "@/lib/email/template-registry";
import { useRouter } from "@/navigation";
import { EmailTemplateEditor, type EmailTemplateEditorHandle } from "./email-template-editor";
import { EmailTemplateList } from "./email-template-list";

export interface EmailTemplateOverride {
	subject: string;
	editorDocument: EmailTemplateEditorDocument;
	html: string;
	plainText: string | null;
	isEnabled: boolean;
}

interface EmailTemplateSettingsClientProps {
	templates: Array<{
		definition: Omit<EmailTemplateDefinition, "renderDefault"> & {
			starterDraftHtml: string;
			starterDraftPlainText: string;
		};
		override: EmailTemplateOverride | null;
	}>;
}

type Draft = {
	subject: string;
	html: string;
	plainText: string;
	editorDocument: EmailTemplateEditorDocument;
};

const createDraft = ({
	definition,
	override,
}: EmailTemplateSettingsClientProps["templates"][number]): Draft => ({
	subject: override?.subject ?? definition.defaultSubject,
	html: override?.html ?? definition.starterDraftHtml,
	plainText: override?.plainText ?? definition.starterDraftPlainText,
	editorDocument: override?.editorDocument ?? {
		type: "doc",
		content: [
			{ type: "paragraph", content: [{ type: "text", text: definition.starterDraftPlainText }] },
		],
	},
});

const hasUnchangedDefaultStarterBody = (
	template: EmailTemplateSettingsClientProps["templates"][number],
	draft: Draft,
) =>
	!template.override &&
	draft.html === template.definition.starterDraftHtml &&
	draft.plainText === template.definition.starterDraftPlainText;

export function EmailTemplateSettingsClient({ templates }: EmailTemplateSettingsClientProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const editorRef = useRef<EmailTemplateEditorHandle>(null);
	const [isPending, startTransition] = useTransition();
	const [selectedKey, setSelectedKey] = useState<EmailTemplateKey | null>(
		templates[0]?.definition.key ?? null,
	);
	const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
		Object.fromEntries(
			templates.map((template) => [template.definition.key, createDraft(template)]),
		),
	);
	const [overrideKeys, setOverrideKeys] = useState<Set<EmailTemplateKey>>(
		() =>
			new Set(
				templates
					.filter((template) => template.override)
					.map((template) => template.definition.key),
			),
	);

	const effectiveTemplates = templates.map((template) =>
		overrideKeys.has(template.definition.key) ? template : { ...template, override: null },
	);
	const selectedTemplate =
		effectiveTemplates.find((template) => template.definition.key === selectedKey) ?? null;
	const draft = selectedKey ? drafts[selectedKey] : null;

	const updateDraft = (partial: Partial<Draft>) => {
		if (!selectedKey) {
			return;
		}
		setDrafts((current) => ({
			...current,
			[selectedKey]: { ...current[selectedKey], ...partial },
		}));
	};

	const selectedStatus =
		selectedKey && overrideKeys.has(selectedKey)
			? t("settings.emailTemplates.status.customized", "Customized")
			: t("settings.emailTemplates.status.default", "Default");

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
		if (selectedTemplate && draft && hasUnchangedDefaultStarterBody(selectedTemplate, draft)) {
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
				toast.success(t("settings.emailTemplates.saved", "Email template saved"));
				refresh();
				return;
			}
			toast.error(
				result.errors?.join("\n") ??
					t("settings.emailTemplates.saveFailed", "Failed to save email template"),
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
				toast.success(t("settings.emailTemplates.testSent", "Test email sent to your account"));
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
					t("settings.emailTemplates.reset", "Email template reset to system template"),
				);
				refresh();
				return;
			}
			toast.error(
				result.errors?.join("\n") ??
					t("settings.emailTemplates.resetFailed", "Failed to reset email template"),
			);
		});
	};

	const handleInsertVariable = (name: string) => {
		const token = `{{${name}}}`;
		editorRef.current?.insertIntoBody(token);
	};

	if (!selectedTemplate || !draft) {
		return (
			<Card>
				<CardContent className="py-10 text-center text-muted-foreground">
					{t(
						"settings.emailTemplates.empty",
						"No email templates are available for this organization.",
					)}
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div className="space-y-1">
						<p className="font-medium text-primary text-sm">
							{t("settings.emailTemplates.eyebrow", "Operational communications")}
						</p>
						<h1 className="font-semibold text-2xl tracking-tight">
							{t("settings.emailTemplates.title", "Email Templates")}
						</h1>
						<p className="max-w-3xl text-muted-foreground text-sm leading-6">
							{t(
								"settings.emailTemplates.description",
								"Select a system email, customize the copy, and keep approved variables visible while preserving safe defaults.",
							)}
						</p>
					</div>
					<Badge variant="outline" className="h-7 px-3">
						{selectedStatus}
					</Badge>
				</div>
			</div>

			<div className="grid gap-6 lg:grid-cols-[minmax(260px,360px)_1fr]">
				<Card className="gap-4 py-4">
					<CardHeader className="px-4">
						<CardTitle className="text-base">
							{t("settings.emailTemplates.systemTemplates", "System templates")}
						</CardTitle>
					</CardHeader>
					<CardContent className="px-4">
						<EmailTemplateList
							templates={effectiveTemplates}
							selectedKey={selectedTemplate.definition.key}
							onSelect={(key) => setSelectedKey(key as EmailTemplateKey)}
						/>
					</CardContent>
				</Card>

				<div className="space-y-6">
					<Card>
						<CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
							<div className="space-y-2">
								<CardTitle className="text-xl">{selectedTemplate.definition.label}</CardTitle>
								<p className="text-muted-foreground text-sm leading-6">
									{selectedTemplate.definition.description}
								</p>
							</div>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="rounded-xl border bg-muted/25 p-4 text-sm">
								<p className="font-medium">
									{t("settings.emailTemplates.defaultFallback", "Default fallback")}
								</p>
								<p className="mt-1 text-muted-foreground">
									{t(
										"settings.emailTemplates.defaultFallbackDescription",
										"If this template uses the system default, Z8 sends the system copy and subject:",
									)}{" "}
									<span className="font-medium text-foreground">
										{selectedTemplate.definition.defaultSubject}
									</span>
								</p>
							</div>

							<EmailTemplateEditor
								key={selectedTemplate.definition.key}
								ref={editorRef}
								definition={selectedTemplate.definition}
								subject={draft.subject}
								html={draft.html}
								plainText={draft.plainText}
								editorDocument={draft.editorDocument}
								variables={selectedTemplate.definition.variables}
								onSubjectChange={(subject) => updateDraft({ subject })}
								onHtmlChange={(html) => updateDraft({ html })}
								onPlainTextChange={(plainText) => updateDraft({ plainText })}
								onEditorDocumentChange={(editorDocument) => updateDraft({ editorDocument })}
								onInsertVariable={handleInsertVariable}
								onSubjectFocus={() => undefined}
							/>

							<div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
								<Button type="button" variant="outline" onClick={handleReset} disabled={isPending}>
									{t("settings.emailTemplates.actions.reset", "Reset to system template")}
								</Button>
								<Button
									type="button"
									variant="secondary"
									onClick={handleSendTest}
									disabled={isPending}
								>
									{t("settings.emailTemplates.actions.sendTest", "Send test")}
								</Button>
								<Button type="button" onClick={handleSave} disabled={isPending}>
									{t("settings.emailTemplates.actions.save", "Save")}
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
