/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EmailTemplateDefinition } from "@/lib/email/template-registry";
import { EmailTemplateEditor } from "./email-template-editor";

vi.mock("next/dynamic", () => ({
	default: () =>
		function ReactEmailEditorMock({
			className,
			placeholder,
		}: {
			className?: string;
			placeholder?: string;
		}) {
			return (
				<div data-testid="react-email-editor" className={className}>
					{placeholder}
				</div>
			);
		},
}));

vi.mock("@react-email/editor", () => ({
	EmailEditor: ({ className, placeholder }: { className?: string; placeholder?: string }) => (
		<div data-testid="react-email-editor-module" className={className}>
			{placeholder}
		</div>
	),
}));

const definition: Omit<EmailTemplateDefinition, "renderDefault"> = {
	key: "organization-invitation",
	label: "Organization invitation",
	description: "Sent when a user is invited to join an organization.",
	category: "auth",
	variables: [],
	previewData: {},
	defaultSubject: "You have been invited to {{organizationName}}",
};

function renderEditor() {
	render(
		<EmailTemplateEditor
			definition={definition}
			subject="You have been invited to {{organizationName}}"
			html="<p>Sent when a user is invited to join an organization.</p>"
			plainText="Sent when a user is invited to join an organization."
			editorDocument={{ type: "doc" }}
			variables={[]}
			onSubjectChange={vi.fn()}
			onHtmlChange={vi.fn()}
			onPlainTextChange={vi.fn()}
			onEditorDocumentChange={vi.fn()}
			onInsertVariable={vi.fn()}
		/>,
	);
}

describe("EmailTemplateEditor", () => {
	it("applies theme-aware styles to the rich email editor", () => {
		renderEditor();

		const group = screen.getByRole("group", { name: "Email body" });
		const editor = screen.getByTestId("react-email-editor");

		expect(group.className).toBe("rounded-xl border bg-background p-2");
		expect(editor.className).not.toContain("email-template-editor-surface");
		expect(editor.className).toContain("[&_.ProseMirror]:!bg-background");
		expect(editor.className).toContain("dark:[&_.ProseMirror]:!bg-card");
		expect(editor.className).toContain("[&_.ProseMirror]:text-foreground");
		expect(editor.className).toContain("[&_.ProseMirror]:p-3");
	});
});
