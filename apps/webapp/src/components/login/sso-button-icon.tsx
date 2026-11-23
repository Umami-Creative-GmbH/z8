import {
	IconBrandApple,
	IconBrandAuth0,
	IconBrandGithub,
	IconBrandGoogle,
	IconBrandWindows,
	IconFingerprint,
	IconIdBadge,
	IconKey,
	IconLock,
	IconShieldCheck,
} from "@tabler/icons-react";
import type { SsoButtonIconName } from "@/lib/domain/sso-button";

const icons = {
	fingerprint: IconFingerprint,
	microsoft: IconBrandWindows,
	google: IconBrandGoogle,
	github: IconBrandGithub,
	apple: IconBrandApple,
	auth0: IconBrandAuth0,
	key: IconKey,
	lock: IconLock,
	shield: IconShieldCheck,
	badge: IconIdBadge,
} satisfies Record<SsoButtonIconName, typeof IconFingerprint>;

export function SsoButtonIcon({ name }: { name?: SsoButtonIconName }) {
	const Icon = name && Object.hasOwn(icons, name) ? icons[name] : IconFingerprint;
	return <Icon className="size-4 shrink-0" aria-hidden="true" />;
}
