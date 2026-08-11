import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript/unstable/ast";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as nativeSourceAnalysis from "@/lib/typescript/native-source-analysis";

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

const withNativeSource = vi.spyOn(nativeSourceAnalysis, "withNativeSource");
const lineCountsByFile = new Map<string, Map<string, number>>();

function functionAstLines(filePath: string, functionName: string) {
	let counts = lineCountsByFile.get(filePath);
	if (!counts) {
		const sourceText = readFileSync(filePath, "utf8");
		counts = nativeSourceAnalysis.withNativeSource(
			sourceText,
			filePath,
			({ sourceFile }) => {
				const fileCounts = new Map<string, number>();

				function visit(node: ts.Node) {
					if (ts.isFunctionDeclaration(node) && node.name) {
						const start = sourceFile.getLineAndCharacterOfPosition(
							node.getStart(sourceFile),
						);
						const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
						fileCounts.set(node.name.text, end.line - start.line + 1);
					}
					node.forEachChild(visit);
				}

				visit(sourceFile);
				return fileCounts;
			},
		);
		lineCountsByFile.set(filePath, counts);
	}

	const lines = counts.get(functionName);
	if (lines === undefined)
		throw new Error(`${functionName} not found in ${filePath}`);
	return lines;
}

afterAll(() => {
	let nativeSourceCallCount = 0;
	try {
		nativeSourceCallCount = withNativeSource.mock.calls.length;
	} finally {
		try {
			withNativeSource.mockRestore();
		} finally {
			lineCountsByFile.clear();
		}
	}
	expect(nativeSourceCallCount).toBe(
		new Set(targets.map(([relativePath]) => relativePath)).size,
	);
});

describe("large form module boundaries", () => {
	it.each(targets)(
		"keeps %s#%s within 300 AST lines",
		(relativePath, functionName) => {
			const filePath = join(process.cwd(), "src/components", relativePath);
			expect(functionAstLines(filePath, functionName)).toBeLessThanOrEqual(
				MAX_AST_LINES,
			);
		},
	);
});
