import JSZip from "jszip";
import type { ChatInstallationStatus, ChatVerificationState } from "@/db/schema/chat-installations";

export const TEAMS_MANIFEST_SCHEMA_URL =
	"https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json";
export const TEAMS_MANIFEST_VERSION = "1.16";
export const TEAMS_PLACEHOLDER_APP_ID = "00000000-0000-0000-0000-000000000000";

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Minimal valid 192x192 RGBA slate PNG for Teams App Package color.png
const TEAMS_COLOR_ICON_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAABiklEQVR42u3TMQ0AAAjAMBxw4gH//sAEHz1qYMkiqwe+ChEwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADIABRMAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABMIAIGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAaASwsdQ3sFUwQJzwAAAABJRU5ErkJggg==";

// Minimal valid 32x32 RGBA white PNG for Teams App Package outline.png
const TEAMS_OUTLINE_ICON_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKUlEQVR42u3OIQEAAAACIP+f1hkWWEB6FgEBAQEBAQEBAQEBAQEBgXdgl/rw4tnPBf0AAAAASUVORK5CYII=";

export type TeamsVerificationStepStatus = "passed" | "pending" | "failed" | "expired";

export interface TeamsVerificationStepView {
	status: TeamsVerificationStepStatus;
	verifiedAt: string | null;
	expiresAt: string | null;
	detail: string | null;
	failureCode: string | null;
}

export interface TeamsAppManifestDocument {
	$schema: string;
	manifestVersion: string;
	version: string;
	id: string;
	packageName: string;
	developer: {
		name: string;
		websiteUrl: string;
		privacyUrl: string;
		termsOfUseUrl: string;
	};
	icons: {
		color: string;
		outline: string;
	};
	name: {
		short: string;
		full: string;
	};
	description: {
		short: string;
		full: string;
	};
	accentColor: string;
	bots: Array<{
		botId: string;
		scopes: ["personal"];
		supportsFiles: boolean;
		isNotificationOnly: boolean;
		commandLists: Array<{
			scopes: ["personal"];
			commands: Array<{
				title: string;
				description: string;
			}>;
		}>;
	}>;
	permissions: string[];
	validDomains: string[];
}

export interface TeamsAdminRolloutStep {
	stepNumber: number;
	id:
		| "azure_bot_registration"
		| "configure_messaging_endpoint"
		| "save_credentials_in_z8"
		| "upload_teams_admin_center"
		| "verify_private_chat";
	title: string;
	summary: string;
}

export interface GeneratedTeamsAppPackage {
	manifest: TeamsAppManifestDocument;
	manifestJson: string;
	messagingEndpointUrl: string;
	rolloutInstructions: TeamsAdminRolloutStep[];
	manifestFileName: string;
	packageFileName: string;
	usesPlaceholderAppId: boolean;
}

export interface TeamsCandidateSetupView {
	installationId: string;
	organizationId: string;
	routeId: string;
	status: ChatInstallationStatus;
	verificationState: ChatVerificationState;
	readyForSwitch: boolean;
	microsoftAppId: string | null;
	microsoftTenantId: string | null;
	tenantDisplayName: string | null;
	hasStoredCredentials: boolean;
	credentialRevisionNumber: number | null;
	messagingEndpointUrl: string;
	manifestJson: string;
	manifestFileName: string;
	packageFileName: string;
	usesPlaceholderAppId: boolean;
	rolloutInstructions: TeamsAdminRolloutStep[];
	hasPrivateReachability: boolean;
	privateReachabilityUpdatedAt: string | null;
	enrollmentProofCount: number;
	steps: {
		credentials: TeamsVerificationStepView;
		inboundProof: TeamsVerificationStepView;
		privateTest: TeamsVerificationStepView;
	};
	lastVerifiedAt: string | null;
	updatedAt: string;
}

function normalizeBaseUrl(rawUrl?: string): string {
	const raw = (rawUrl || "https://z8-time.app").trim();
	return raw.replace(/\/+$/, "");
}

function extractValidDomain(baseUrl: string): string {
	try {
		return new URL(baseUrl).hostname;
	} catch {
		return "z8-time.app";
	}
}

/**
 * Generates a Microsoft Teams v1.16 single-tenant app manifest, dedicated non-secret
 * `routeId`-scoped messaging endpoint, and Microsoft Teams Admin Center rollout steps.
 */
export function generateTeamsAppPackage(input: {
	routeId: string;
	microsoftAppId?: string | null;
	appUrl?: string;
	organizationName?: string | null;
}): GeneratedTeamsAppPackage {
	const baseUrl = normalizeBaseUrl(input.appUrl);
	const routeSegment = encodeURIComponent(input.routeId.trim());
	const messagingEndpointUrl = `${baseUrl}/api/teams/installations/${routeSegment}/messages`;
	const domain = extractValidDomain(baseUrl);

	const trimmedAppId = input.microsoftAppId?.trim() ?? "";
	const hasValidAppId = GUID_PATTERN.test(trimmedAppId);
	const effectiveAppId = hasValidAppId ? trimmedAppId.toLowerCase() : TEAMS_PLACEHOLDER_APP_ID;

	const orgLabel = input.organizationName?.trim();
	const rawShortName = orgLabel ? `Z8 (${orgLabel})` : "Z8 Workforce";
	const shortName = rawShortName.length > 30 ? `${rawShortName.slice(0, 27)}...` : rawShortName;
	const fullName = orgLabel
		? `Z8 Time & Workforce (${orgLabel})`
		: "Z8 Time Tracking & Workforce Management";

	const manifest: TeamsAppManifestDocument = {
		$schema: TEAMS_MANIFEST_SCHEMA_URL,
		manifestVersion: TEAMS_MANIFEST_VERSION,
		version: "1.0.0",
		id: effectiveAppId,
		packageName: "app.z8time.teams.singletenant",
		developer: {
			name: "Z8 Workforce",
			websiteUrl: baseUrl,
			privacyUrl: `${baseUrl}/privacy`,
			termsOfUseUrl: `${baseUrl}/terms`,
		},
		icons: {
			color: "color.png",
			outline: "outline.png",
		},
		name: {
			short: shortName,
			full: fullName,
		},
		description: {
			short: "Z8 notifications, approvals, and time tracking",
			full: "Organization-owned single-tenant Microsoft Teams app for Z8 notifications, approval cards, daily digests, and employee commands.",
		},
		accentColor: "#0F172A",
		bots: [
			{
				botId: effectiveAppId,
				scopes: ["personal"],
				supportsFiles: false,
				isNotificationOnly: false,
				commandLists: [
					{
						scopes: ["personal"],
						commands: [
							{ title: "help", description: "Show available Z8 commands and linking info" },
							{ title: "status", description: "Check your current clock-in status" },
							{ title: "clockin", description: "Clock in for work" },
							{ title: "clockout", description: "Clock out from work" },
							{ title: "pending", description: "View pending approvals" },
							{ title: "whosout", description: "See who is out today" },
						],
					},
				],
			},
		],
		permissions: ["identity", "messageTeamMembers"],
		validDomains: [domain],
	};

	const rolloutInstructions: TeamsAdminRolloutStep[] = [
		{
			stepNumber: 1,
			id: "azure_bot_registration",
			title: "Create a Single-Tenant Azure Bot & Entra App Registration",
			summary:
				"In Azure Portal, create an Azure Bot with Type = Single Tenant under your organization's Microsoft Entra ID tenant, enable the Microsoft Teams channel, and generate a Client Secret.",
		},
		{
			stepNumber: 2,
			id: "configure_messaging_endpoint",
			title: "Configure the dedicated Z8 Messaging Endpoint",
			summary: `Set the Azure Bot Messaging endpoint to ${messagingEndpointUrl}. Keep this installation route dedicated to your organization.`,
		},
		{
			stepNumber: 3,
			id: "save_credentials_in_z8",
			title: "Save single-tenant credentials in Z8 (write-only)",
			summary:
				"Enter the Microsoft App ID (GUID), Microsoft Entra Tenant ID (GUID), and Client Secret below. Z8 stores the secret in an immutable credential revision and updates your app package manifest with your App ID.",
		},
		{
			stepNumber: 4,
			id: "upload_teams_admin_center",
			title: "Upload app package in Microsoft Teams Admin Center",
			summary:
				"Download the single-tenant Teams App Package (.zip), open Microsoft Teams Admin Center (admin.teams.microsoft.com) → Teams apps → Manage apps → Upload new app, and assign it via your App setup policy.",
		},
		{
			stepNumber: 5,
			id: "verify_private_chat",
			title: "Verify authenticated inbound activity & proactive private delivery",
			summary:
				"Open a 1:1 personal chat with your new Teams bot and send a message (for example, 'verify'). Then return here to refresh verification status and send the proactive private test message.",
		},
	];

	return {
		manifest,
		manifestJson: JSON.stringify(manifest, null, 2),
		messagingEndpointUrl,
		rolloutInstructions,
		manifestFileName: "manifest.json",
		packageFileName: "z8-teams-single-tenant-app.zip",
		usesPlaceholderAppId: !hasValidAppId,
	};
}

/**
 * Builds a ready-to-upload Microsoft Teams App Package (.zip) containing
 * `manifest.json`, `color.png` (192x192), and `outline.png` (32x32).
 */
export async function buildTeamsAppPackageZip(manifestJson: string): Promise<Uint8Array> {
	const zip = new JSZip();
	zip.file("manifest.json", manifestJson);
	zip.file("color.png", TEAMS_COLOR_ICON_PNG_BASE64, { base64: true });
	zip.file("outline.png", TEAMS_OUTLINE_ICON_PNG_BASE64, { base64: true });
	return zip.generateAsync({ type: "uint8array" });
}
