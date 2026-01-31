import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import type { SocialOAuthProvider } from "@/db/schema";
import { env } from "@/env";
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

const VALID_PROVIDERS: SocialOAuthProvider[] = ["google", "github", "linkedin", "apple"];

/**
 * Validate callback URL to prevent open redirect attacks
 */
function isValidCallbackURL(url: string): boolean {
	// Only allow relative URLs starting with /
	if (!url.startsWith("/")) return false;
	// Prevent protocol-relative URLs (//evil.com)
	if (url.startsWith("//")) return false;
	// Prevent javascript: or data: URLs
	if (/^(javascript|data|vbscript):/i.test(url)) return false;
	return true;
}

// Session settings (match Better Auth defaults)
const SESSION_EXPIRY_DAYS = 7;
const SESSION_COOKIE_NAME = "better-auth.session_token";

/**
 * Generate a secure random ID
 */
function generateId(length = 32): string {
	return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

/**
 * Create a session for a user
 */
async function createSession(
	userId: string,
	request: NextRequest,
): Promise<{ token: string; expiresAt: Date }> {
	const token = generateId(32);
	const sessionId = generateId(32);
	const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

	// Get request metadata
	const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0] || null;
	const userAgent = request.headers.get("user-agent") || null;

	// Create session in database
	await db.insert(authSchema.session).values({
		id: sessionId,
		token,
		userId,
		expiresAt,
		ipAddress,
		userAgent,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	return { token, expiresAt };
}

/**
 * Find or create a user and link their OAuth account
 */
async function findOrCreateUserWithAccount(params: {
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

	// Check if account already exists
	const existingAccount = await db.query.account.findFirst({
		where: and(
			eq(authSchema.account.providerId, provider),
			eq(authSchema.account.accountId, providerUserId),
		),
	});

	if (existingAccount) {
		// Update tokens
		await db
			.update(authSchema.account)
			.set({
				accessToken,
				refreshToken,
				idToken,
				accessTokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
				updatedAt: new Date(),
			})
			.where(eq(authSchema.account.id, existingAccount.id));

		return { userId: existingAccount.userId, isNewUser: false };
	}

	// Check if user exists with this email
	const existingUser = await db.query.user.findFirst({
		where: eq(authSchema.user.email, email),
	});

	if (existingUser) {
		// Link new account to existing user
		await db.insert(authSchema.account).values({
			id: generateId(32),
			accountId: providerUserId,
			providerId: provider,
			userId: existingUser.id,
			accessToken,
			refreshToken,
			idToken,
			accessTokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
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
		email,
		name: name || email.split("@")[0],
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
		accessTokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
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
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ provider: string }> },
) {
	return handleCallback(request, params, "GET");
}

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ provider: string }> },
) {
	return handleCallback(request, params, "POST");
}

async function handleCallback(
	request: NextRequest,
	paramsPromise: Promise<{ provider: string }>,
	method: "GET" | "POST",
) {
	const { provider: providerParam } = await paramsPromise;

	// Validate provider
	if (!VALID_PROVIDERS.includes(providerParam as SocialOAuthProvider)) {
		return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
	}
	const provider = providerParam as SocialOAuthProvider;

	let code: string;
	let stateParam: string;
	let appleUser: { name?: { firstName?: string; lastName?: string }; email?: string } | undefined;
	let appleIdToken: string | undefined;

	// Parse request based on method (Apple uses POST with form_post)
	if (method === "POST" && provider === "apple") {
		const formData = await request.formData();
		const parsed = parseAppleFormPost(formData);
		code = parsed.code;
		stateParam = parsed.state;
		appleUser = parsed.user;
		appleIdToken = parsed.idToken;
	} else {
		code = request.nextUrl.searchParams.get("code") || "";
		stateParam = request.nextUrl.searchParams.get("state") || "";
	}

	if (!code || !stateParam) {
		logger.warn({ provider, hasCode: !!code, hasState: !!stateParam }, "Missing code or state");
		return NextResponse.redirect(new URL("/sign-in?error=invalid_request", request.url));
	}

	// Get state from cookie
	const cookieStore = await cookies();
	const stateCookie = cookieStore.get(STATE_COOKIE_NAME);

	if (!stateCookie?.value) {
		logger.warn({ provider }, "State cookie not found");
		return NextResponse.redirect(new URL("/sign-in?error=invalid_state", request.url));
	}

	// Verify state
	const state = verifyOAuthState(stateCookie.value);
	if (!state) {
		logger.warn({ provider }, "State verification failed");
		return NextResponse.redirect(new URL("/sign-in?error=invalid_state", request.url));
	}

	// Clear state cookie
	cookieStore.delete(STATE_COOKIE_NAME);

	// Resolve credentials
	const credentialsResult = await resolveCredentials(state.organizationId, provider);
	if (!credentialsResult) {
		logger.error({ provider, organizationId: state.organizationId }, "No credentials for callback");
		return NextResponse.redirect(new URL("/sign-in?error=configuration_error", request.url));
	}

	try {
		// Build redirect URI
		const host = request.headers.get("host");
		const baseUrl = env.NEXT_PUBLIC_APP_URL || `https://${host}`;
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
			appleIdToken || tokens.idToken,
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

		// Create session
		const session = await createSession(userId, request);

		// Set session cookie
		cookieStore.set(SESSION_COOKIE_NAME, session.token, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			expires: session.expiresAt,
			path: "/",
		});

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
		const safeCallbackURL = isValidCallbackURL(state.callbackURL) ? state.callbackURL : "/";
		const redirectUrl = isNewUser ? "/onboarding" : safeCallbackURL;
		return NextResponse.redirect(new URL(redirectUrl, request.url));
	} catch (error) {
		logger.error({ error, provider }, "OAuth callback failed");
		return NextResponse.redirect(new URL("/sign-in?error=oauth_error", request.url));
	}
}
