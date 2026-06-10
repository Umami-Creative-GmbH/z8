import type { ReactDoctorConfig } from "react-doctor/api";

export default {
	ignore: {
		rules: [
			"react-doctor/nextjs-no-img-element",
			"react-doctor/server-auth-actions",
			"react-doctor/unused-dependency",
			"react-doctor/unused-dev-dependency",
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
