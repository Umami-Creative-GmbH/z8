/**
 * The Better Auth options that shape the generated auth schema
 * (`src/db/auth-schema.ts`). Shared by the runtime instance (`src/lib/auth.ts`)
 * and the CLI-only config (`src/lib/auth.cli.ts`), so `pnpm auth:generate` sees
 * the same tables and fields as production. Keep this module free of imports:
 * the Better Auth CLI must load it without the app's server-only dependencies.
 */

/** User additional fields - these will be included in the generated schema. */
export const AUTH_USER_ADDITIONAL_FIELDS = {
	firstName: {
		type: "string",
		required: false,
		input: true,
	},
	lastName: {
		type: "string",
		required: false,
		input: true,
	},
	canCreateOrganizations: {
		type: "boolean",
		required: false,
		defaultValue: false,
		input: false, // system-managed, not user-provided
	},
	invitedVia: {
		type: "string",
		required: false,
		input: false,
	},
	// Stores invite code during registration until email is verified
	// Processed by afterVerification hook to auto-join organization
	pendingInviteCode: {
		type: "string",
		required: false,
		input: false, // system-managed
	},
} as const;

/** Schema customization for the organization plugin's organization, member and invitation tables. */
export const AUTH_ORGANIZATION_SCHEMA = {
	organization: {
		additionalFields: {
			country: {
				type: "string",
				required: false,
				input: true,
			},
			region: {
				type: "string",
				required: false,
				input: true,
			},
			shiftsEnabled: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: true,
			},
			projectsEnabled: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: true,
			},
			surchargesEnabled: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: true,
			},
			demoDataEnabled: {
				type: "boolean",
				required: false,
				defaultValue: true,
				input: false,
			},
			worksCouncilEnabled: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: false,
			},
			// Billable Time module switch (#897). System-managed: switching it on
			// needs projects and a billable currency, so only the module's own
			// server action writes it.
			billableTimeEnabled: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: false,
			},
			// Personnel files (#865): switched by owners and admins through the features card.
			personnelFilesEnabled: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: false,
			},
			// Equipment tracking (#1572): switched by owners and admins through the features card.
			equipmentEnabled: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: false,
			},
			timezone: {
				type: "string",
				required: false,
				defaultValue: "UTC",
				input: true, // admin can set organization timezone
			},
			deletedAt: {
				type: "date",
				required: false,
				input: false, // system-managed
			},
			deletedBy: {
				type: "string",
				required: false,
				input: false, // system-managed, stores user ID
			},
			// SSO approval configuration: when true, SSO users need approval
			ssoRequiresApproval: {
				type: "boolean",
				required: false,
				defaultValue: true,
				input: true,
			},
		},
	},
	member: {
		additionalFields: {
			// Member status for invite code approval flow
			// "pending" = awaiting admin approval, "approved" = active member, "rejected" = rejected
			status: {
				type: "string",
				required: false,
				defaultValue: "approved", // existing members are approved by default
				input: false, // system-managed
			},
			// Reference to the invite code used to join (if any)
			inviteCodeId: {
				type: "string",
				required: false,
				input: false,
			},
		},
	},
	invitation: {
		additionalFields: {
			canCreateOrganizations: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: true,
			},
			targetTeamId: {
				type: "string",
				required: false,
				input: false,
			},
		},
	},
} as const;

/** SSO domain verification; it adds the provider's `domainVerified` column. */
export const AUTH_SSO_DOMAIN_VERIFICATION = {
	enabled: true,
	tokenPrefix: "z8-auth-",
} as const;
