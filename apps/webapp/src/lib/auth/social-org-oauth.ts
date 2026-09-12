import crypto from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import type { SocialOAuthProvider } from "@/db/schema";
import { getBaseUrlFromHost } from "@/lib/app-url";
import { isAccountBanned } from "@/lib/auth/account-ban";
import { getSafeCallbackPath } from "@/lib/auth/callback-url";
import { createLogger } from "@/lib/logger";
import {
	exchangeCode,
	getUserInfo,
	parseAppleFormPost,
	resolveCredentials,
	STATE_COOKIE_NAME,
	verifyOAuthState,
} from "@/lib/social-oauth";

const logger = createLogger("SocialOAuth:Callback");

const VALID_PROVIDERS: SocialOAuthProvider[] = [
	"google",
	"github",
	"linkedin",
	"apple",
];

function decodeStateParam(encodedState: string): string | null {
	if (!encodedState || encodedState.length > 4096) {
		return null;
	}

	try {
		return Buffer.from(encodedState, "base64url").toString("utf8");
	} catch {
		return null;
	}
}

function timingSafeEqualText(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left, "utf8");
	const rightBuffer = Buffer.from(right, "utf8");

	if (leftBuffer.length !== rightBuffer.length) {
		return false;
	}

	return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Generate a secure random ID
 */
function generateId(length = 32): string {
	return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

function tokenExpiry(expiresIn?: number): Date | null {
	return expiresIn
		? new Date(
				Temporal.Now.instant().add({ seconds: expiresIn }).epochMilliseconds,
			)
		: null;
}

/**
 * Find or create a user and link their OAuth account
 */
export async function findOrCreateUserWithAccount(params: {
	provider: SocialOAuthProvider;
	providerUserId: string;
	email: string;
	emailVerified: boolean;
	name: string | null;
	image: string | null;
	accessToken: string;
	refreshToken?: string;
	idToken?: string;
	expiresIn?: number;
}): Promise<{ userId: string; isNewUser: boolean }> {
	const {
		provider,
		providerUserId,
		email,
		emailVerified,
		name,
		image,
		accessToken,
		refreshToken,
		idToken,
		expiresIn,
	} = params;
	if (!VALID_PROVIDERS.includes(provider)) {
		throw new Error(`Unknown account provider: ${provider}`);
	}
	const normalizedEmail = email.trim().toLowerCase();

	// Check if account already exists
	const existingAccount = await db.query.account.findFirst({
		where: and(
			eq(authSchema.account.providerId, provider),
			eq(authSchema.account.accountId, providerUserId),
		),
	});

	if (existingAccount) {
		const owner = await db.query.user.findFirst({
			where: eq(authSchema.user.id, existingAccount.userId),
		});
		if (!owner || isAccountBanned(owner))
			throw new Error("Account access denied");
		// Update tokens
		await db
			.update(authSchema.account)
			.set({
				accessToken,
				refreshToken,
				idToken,
				accessTokenExpiresAt: tokenExpiry(expiresIn),
				updatedAt: new Date(),
			})
			.where(eq(authSchema.account.id, existingAccount.id));

		return { userId: existingAccount.userId, isNewUser: false };
	}

	// Check if user exists with this email
	const existingUser = await db.query.user.findFirst({
		where: sql`lower(${authSchema.user.email}) = ${normalizedEmail}`,
	});

	if (existingUser) {
		if (isAccountBanned(existingUser)) throw new Error("Account access denied");
		// Matching an email is not proof of ownership of the existing Z8 account.
		if (emailVerified !== true) {
			throw new Error("Verified email required to link an account");
		}

		// Link new account to existing user
		await db.insert(authSchema.account).values({
			id: generateId(32),
			accountId: providerUserId,
			providerId: provider,
			userId: existingUser.id,
			accessToken,
			refreshToken,
			idToken,
			accessTokenExpiresAt: tokenExpiry(expiresIn),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		return { userId: existingUser.id, isNewUser: false };
	}

	// Create new user
	const userId = generateId(32);
	const now = new Date();

	await db.insert(authSchema.user).values({
		id: userId,
		email: normalizedEmail,
		name: name || normalizedEmail.split("@")[0],
		image,
		emailVerified: emailVerified,
		createdAt: now,
		updatedAt: now,
	});

	// Create account link
	await db.insert(authSchema.account).values({
		id: generateId(32),
		accountId: providerUserId,
		providerId: provider,
		userId,
		accessToken,
		refreshToken,
		idToken,
		accessTokenExpiresAt: tokenExpiry(expiresIn),
		createdAt: now,
		updatedAt: now,
	});

	return { userId, isNewUser: true };
}

/**
 * Handle OAuth callback from provider
 *
 * GET /api/auth/callback/social-org/[provider]?code=xxx&state=yyy
 * POST (Apple only) - receives form_post response
 */
async function handleCallback(
	ctx: Parameters<typeof setSessionCookie>[0],
	providerParam: string,
) {
	const request = ctx.request;
	if (!request) throw new Error("OAuth callback requires the original request");
	const method = request.method;

	// Validate provider
	if (!VALID_PROVIDERS.includes(providerParam as SocialOAuthProvider)) {
		return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
	}
	const provider = providerParam as SocialOAuthProvider;

	let code: string;
	let stateParam: string;
	let appleUser:
		| { name?: { firstName?: string; lastName?: string }; email?: string }
		| undefined;
	let appleIdToken: string | undefined;

	// Parse request based on method (Apple uses POST with form_post)
	if (method === "POST" && provider === "apple") {
		const formData = new FormData();
		for (const [key, value] of Object.entries(ctx.body ?? {})) {
			if (typeof value === "string") formData.set(key, value);
		}
		const parsed = parseAppleFormPost(formData);
		code = parsed.code;
		stateParam = parsed.state;
		appleUser = parsed.user;
		appleIdToken = parsed.idToken;
	} else {
		code = new URL(request.url).searchParams.get("code") || "";
		stateParam = new URL(request.url).searchParams.get("state") || "";
	}

	if (!code || !stateParam) {
		logger.warn(
			{ provider, hasCode: !!code, hasState: !!stateParam },
			"Missing code or state",
		);
		return NextResponse.redirect(
			new URL("/sign-in?error=invalid_request", request.url),
		);
	}

	// Get state from cookie
	const stateCookie = ctx.getCookie(STATE_COOKIE_NAME);

	if (!stateCookie) {
		logger.warn({ provider }, "State cookie not found");
		return NextResponse.redirect(
			new URL("/sign-in?error=invalid_state", request.url),
		);
	}

	const stateFromParam = decodeStateParam(stateParam);
	if (!stateFromParam) {
		logger.warn({ provider }, "State parameter decode failed");
		return NextResponse.redirect(
			new URL("/sign-in?error=invalid_state", request.url),
		);
	}

	if (!timingSafeEqualText(stateCookie, stateFromParam)) {
		logger.warn({ provider }, "State cookie does not match callback state");
		return NextResponse.redirect(
			new URL("/sign-in?error=invalid_state", request.url),
		);
	}

	// Verify state
	const state = verifyOAuthState(stateFromParam);
	if (!state) {
		logger.warn({ provider }, "State verification failed");
		return NextResponse.redirect(
			new URL("/sign-in?error=invalid_state", request.url),
		);
	}

	// Clear state cookie
	ctx.setCookie(STATE_COOKIE_NAME, "", { path: "/", maxAge: 0 });

	// Resolve credentials
	const credentialsResult = await resolveCredentials(
		state.organizationId,
		provider,
	);
	if (!credentialsResult) {
		logger.error(
			{ provider, organizationId: state.organizationId },
			"No credentials for callback",
		);
		return NextResponse.redirect(
			new URL("/sign-in?error=configuration_error", request.url),
		);
	}

	try {
		// Build redirect URI
		const host = request.headers.get("host");
		const baseUrl = getBaseUrlFromHost(host);
		const redirectUri = `${baseUrl}/api/auth/callback/social-org/${provider}`;

		// Exchange code for tokens
		const tokens = await exchangeCode({
			provider,
			credentials: credentialsResult.credentials,
			code,
			redirectUri,
			codeVerifier: state.codeVerifier,
		});

		// Get user info
		const userInfo = await getUserInfo(
			provider,
			tokens.accessToken,
			tokens.idToken || appleIdToken,
		);

		// For Apple, user info (especially name) is only provided on first auth
		// and comes via form_post, not via ID token
		let userName = userInfo.name;
		if (provider === "apple" && appleUser?.name) {
			const firstName = appleUser.name.firstName || "";
			const lastName = appleUser.name.lastName || "";
			userName = `${firstName} ${lastName}`.trim() || null;
		}

		// Find or create user with linked account
		const { userId, isNewUser } = await findOrCreateUserWithAccount({
			provider,
			providerUserId: userInfo.providerUserId,
			email: userInfo.email,
			emailVerified: userInfo.emailVerified,
			name: userName,
			image: userInfo.image,
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			idToken: tokens.idToken,
			expiresIn: tokens.expiresIn,
		});

		// Run in Better Auth's actual endpoint context so all database and
		// session hooks, configured expiry, cache writes and cookie signing apply.
		const user = await ctx.context.internalAdapter.findUserById(userId);
		if (!user || isAccountBanned(user))
			throw new Error("Account access denied");
		const session = await ctx.context.internalAdapter.createSession(userId);
		if (!session) throw new Error("Session creation rejected");
		await setSessionCookie(ctx, { session, user });

		logger.info(
			{
				provider,
				userId,
				isNewUser,
				organizationId: state.organizationId,
				isOrgSpecific: credentialsResult.isOrgSpecific,
			},
			"OAuth login successful",
		);

		// Redirect to callback URL (validate to prevent open redirect)
		// If new user, might want to redirect to onboarding
		const safeCallbackURL = getSafeCallbackPath(state.callbackURL) ?? "/";
		const redirectUrl = isNewUser ? "/onboarding" : safeCallbackURL;
		return NextResponse.redirect(new URL(redirectUrl, request.url));
	} catch (error) {
		logger.error({ error, provider }, "OAuth callback failed");
		return NextResponse.redirect(
			new URL("/sign-in?error=oauth_error", request.url),
		);
	}
}

/** Public endpoint accepts only the OAuth callback, never a caller-chosen user ID. */
export function socialOrgOAuthPlugin() {
	return {
		id: "z8-social-org-oauth",
		endpoints: {
			socialOrgOAuthCallback: createAuthEndpoint(
				"/callback/social-org/:provider",
				{
					method: ["GET", "POST"],
					body: z.record(z.string(), z.string()).optional(),
					metadata: {
						allowedMediaTypes: [
							"application/x-www-form-urlencoded",
							"application/json",
						],
					},
				},
				async (ctx) => {
					const response = await handleCallback(ctx, ctx.params.provider);
					const location = response.headers.get("location");
					// Throw outside the callback's error handler. Better Auth then merges
					// signed cookies and runs after hooks, including session-proof hooks.
					if (location) throw ctx.redirect(location);
					return response;
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
