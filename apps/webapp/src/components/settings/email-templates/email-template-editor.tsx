"use client";

import "@react-email/editor/themes/default.css";
import dynamic from "next/dynamic";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { EmailTemplateDefinition } from "@/lib/email/template-registry";

type ReactEmailEditorRef = {
	getEmail: () => Promise<{ html: string; text: string }>;
	getJSON: () => Record<string, unknown>;
};

const ReactEmailEditor = dynamic(
	() => import("@react-email/editor").then((module) => module.EmailEditor),
	{
		ssr: false,
		loading: () => (
			<div className="flex min-h-56 items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground text-sm">
				Loading email editor...
			</div>
		),
	},
);

interface EmailTemplateEditorProps {
	definition: Omit<EmailTemplateDefinition, "renderDefault">;
	subject: string;
	html: string;
	plainText: string;
	editorDocument: Record<string, unknown>;
	onSubjectChange: (value: string) => void;
	onHtmlChange: (value: string) => void;
	onPlainTextChange: (value: string) => void;
	onEditorDocumentChange: (value: Record<string, unknown>) => void;
	onSubjectFocus?: () => void;
}

export interface EmailTemplateEditorHandle {
	focusSubject: () => void;
	insertIntoSubject: (value: string) => void;
}

export const EmailTemplateEditor = forwardRef<EmailTemplateEditorHandle, EmailTemplateEditorProps>(
	function EmailTemplateEditor(
		{
			definition,
			subject,
			html,
			plainText,
			editorDocument,
			onSubjectChange,
			onHtmlChange,
			onPlainTextChange,
			onEditorDocumentChange,
			onSubjectFocus,
		},
		ref,
	) {
		const subjectRef = useRef<HTMLInputElement>(null);
		const updateVersionRef = useRef(0);

		useImperativeHandle(ref, () => ({
			focusSubject: () => subjectRef.current?.focus(),
			insertIntoSubject: (value) => {
				const input = subjectRef.current;
				const start = input?.selectionStart ?? subject.length;
				const end = input?.selectionEnd ?? start;
				const nextSubject = `${subject.slice(0, start)}${value}${subject.slice(end)}`;
				onSubjectChange(nextSubject);
				queueMicrotask(() => {
					input?.focus();
					input?.setSelectionRange(start + value.length, start + value.length);
				});
			},
		}));

		return (
			<div className="space-y-5">
				<div className="grid gap-2">
					<Label htmlFor="email-template-subject">Subject</Label>
					<Input
						ref={subjectRef}
						id="email-template-subject"
						value={subject}
						onChange={(event) => onSubjectChange(event.target.value)}
						onFocus={onSubjectFocus}
						placeholder={definition.defaultSubject}
					/>
				</div>

				<div className="grid gap-2">
					<p id="email-template-body-label" className="font-medium text-sm leading-none">
						Email body
					</p>
					<p id="email-template-body-description" className="text-muted-foreground text-xs">
						Compose the rich HTML email sent for this system event.
					</p>
					<div
						role="group"
						aria-labelledby="email-template-body-label"
						aria-describedby="email-template-body-description"
						className="rounded-xl border bg-background p-2"
					>
						<ReactEmailEditor
							content={editorDocument}
							placeholder="Write the operational email body..."
							className="min-h-64"
							onUpdate={async (editorRef: ReactEmailEditorRef) => {
								const updateVersion = updateVersionRef.current + 1;
								updateVersionRef.current = updateVersion;
								const [email, json] = await Promise.all([
									editorRef.getEmail(),
									Promise.resolve(editorRef.getJSON()),
								]);
								if (updateVersion !== updateVersionRef.current) {
									return;
								}
								onHtmlChange(email.html);
								onPlainTextChange(email.text);
								onEditorDocumentChange(json);
							}}
						/>
					</div>
				</div>

				<div className="grid gap-2">
					<Label htmlFor="email-template-html-fallback">HTML fallback</Label>
					<Textarea
						id="email-template-html-fallback"
						value={html}
						onChange={(event) => onHtmlChange(event.target.value)}
						className="min-h-24 font-mono text-xs"
					/>
					<p className="text-muted-foreground text-xs">
						Used for validation and as a safe fallback if the visual editor cannot render.
					</p>
				</div>

				<input type="hidden" value={plainText} readOnly aria-hidden="true" />
			</div>
		);
	},
);
