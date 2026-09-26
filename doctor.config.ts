import type { ReactDoctorConfig } from "react-doctor/api";

export default {
	supplyChain: {
		minScore: 0.46,
	},
	ignore: {
		rules: [
			"react-doctor/nextjs-no-img-element",
			"react-doctor/server-auth-actions",
			"react-doctor/unused-dependency",
			"react-doctor/unused-dev-dependency",
		],
		overrides: [
			{
				// Legacy storage is guarded against nonempty rows, then dropped immediately after disabling RLS.
				files: ["**/drizzle/0062_better_auth_scim_storage.sql"],
				rules: ["react-doctor/supabase-rls-policy-risk"],
			},
			{
				// TanStack Form array fields are addressed by index (`changes[${index}]`), so the index
				// is the row identity; draft change rows have no other identity until submitted.
				files: ["**/components/settings/work-diagnostics/work-proposal-panel.tsx"],
				rules: ["react-doctor/no-array-index-as-key"],
			},
		],
	},
	serverAuthFunctionNames: [
		"getAuthContext",
		"getCurrentEmployee",
		"getEmployeeSettingsActorContext",
		"requireAdmin",
		"requireAuth",
		"requireOrgAdminEmployeeSettingsAccess",
		"requirePlatformAdmin",
		"requireSettingsActorEmployeeRecord",
		"requireSystemAdmin",
		"requireUser",
	],
} satisfies ReactDoctorConfig;
