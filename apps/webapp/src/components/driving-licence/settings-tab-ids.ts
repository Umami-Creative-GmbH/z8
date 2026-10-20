/** `?tab=` values of `/settings/driving-licence`, in display order, so each tab can be linked to. */
export const DRIVING_LICENCE_SETTINGS_TABS = [
	"policy",
	"intended-drivers",
	"verifiers",
	"retention",
] as const;
export type DrivingLicenceSettingsTab = (typeof DRIVING_LICENCE_SETTINGS_TABS)[number];
