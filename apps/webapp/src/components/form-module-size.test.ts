import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const MAX_AST_LINES = 300;

const targets = [
	["accept-invitation-form.tsx", "AcceptInvitationForm"],
	["accept-invitation-form-body.tsx", "AcceptInvitationFormBody"],
	["enterprise/api-key-create-dialog.tsx", "ApiKeyCreateDialog"],
	["enterprise/api-key-create-form-body.tsx", "ApiKeyCreateFormBody"],
	["enterprise/api-key-create-form-body.tsx", "useApiKeyCreateController"],
	["join-organization-form.tsx", "JoinOrganizationFormContent"],
	["join-organization-form-body.tsx", "JoinOrganizationFormBody"],
	["signup-form.tsx", "SignupForm"],
	["signup-form-controller.ts", "useSignupFormController"],
	["signup-form-body.tsx", "SignupFormBody"],
	["signup-form-body.tsx", "SignupSocialAuth"],
	["signup-form-fields.tsx", "SignupIdentityFields"],
	["signup-form-fields.tsx", "SignupPasswordFields"],
	["signup-form-fields.tsx", "SignupVerificationFields"],
	["webhooks/webhook-form-dialog.tsx", "WebhookFormDialogForm"],
	["webhooks/webhook-form-body.tsx", "WebhookFormBody"],
	["webhooks/webhook-form-controller.ts", "useWebhookFormController"],
	["webhooks/webhook-form-fields.tsx", "WebhookBasicFields"],
	["webhooks/webhook-form-fields.tsx", "WebhookEventFields"],
] as const;

function functionAstLines(filePath: string, functionName: string) {
	const sourceText = readFileSync(filePath, "utf8");
	const sourceFile = ts.createSourceFile(
		filePath,
		sourceText,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	let match: ts.Node | undefined;

	function visit(node: ts.Node) {
		if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
			match = node;
		}
		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	if (!match) throw new Error(`${functionName} not found in ${filePath}`);

	const start = sourceFile.getLineAndCharacterOfPosition(
		match.getStart(sourceFile),
	);
	const end = sourceFile.getLineAndCharacterOfPosition(match.getEnd());
	return end.line - start.line + 1;
}

describe("large form module boundaries", () => {
	it.each(
		targets,
	)("keeps %s#%s within 300 AST lines", (relativePath, functionName) => {
		const filePath = join(process.cwd(), "src/components", relativePath);
		expect(functionAstLines(filePath, functionName)).toBeLessThanOrEqual(
			MAX_AST_LINES,
		);
	});
});
