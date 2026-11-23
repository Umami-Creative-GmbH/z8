export const SSO_BUTTON_LABEL_MAX_LENGTH = 80;

export const SSO_BUTTON_ICONS = [
	"fingerprint",
	"microsoft",
	"google",
	"github",
	"apple",
	"auth0",
	"key",
	"lock",
	"shield",
	"badge",
] as const;

export type SsoButtonIconName = (typeof SSO_BUTTON_ICONS)[number];
