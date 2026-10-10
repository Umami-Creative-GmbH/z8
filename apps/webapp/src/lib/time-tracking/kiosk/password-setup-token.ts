import { randomBytes } from "node:crypto";
import { passwordSetupMarkerIdentifier } from "@/lib/auth/password-setup-verification";

/** The part of Better Auth's context (`auth.$context`) a setup token needs. */
export type PasswordSetupAuthContext = {
	internalAdapter: {
		createVerificationValue(data: {
			identifier: string;
			value: string;
			expiresAt: Date;
		}): Promise<unknown>;
	};
};

/** As long as an organization invitation stays open (Better Auth's default, 48 hours). */
export const PASSWORD_SETUP_TOKEN_TTL_SECONDS = 48 * 60 * 60;

/**
 * A single-use token with which a former kiosk-only employee chooses their
 * first password (#857). It is a Better Auth password reset token, stored where
 * Better Auth keeps verification values, so the ordinary reset-password page
 * consumes it and creates the credential the user never had. A second value
 * marks it as a setup link, so completing it also verifies the address
 * (`passwordSetupVerification`).
 */
export async function createPasswordSetupToken(
	context: PasswordSetupAuthContext,
	userId: string,
	ttlSeconds: number = PASSWORD_SETUP_TOKEN_TTL_SECONDS,
): Promise<string> {
	const token = randomBytes(32).toString("base64url");
	const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
	await context.internalAdapter.createVerificationValue({
		identifier: passwordSetupMarkerIdentifier(token),
		value: userId,
		expiresAt,
	});
	await context.internalAdapter.createVerificationValue({
		identifier: `reset-password:${token}`,
		value: userId,
		expiresAt,
	});
	return token;
}
