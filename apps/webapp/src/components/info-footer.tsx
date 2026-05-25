"use client";

import { useTranslate } from "@tolgee/react";
import { Link } from "@/navigation";

const EXTERNAL_INFO_LINKS = {
	terms: "https://www.z8-time.app/terms-app",
	privacy: "https://www.z8-time.app/privacy-app",
	imprint: "https://www.z8-time.app/imprint",
	agb: "https://www.z8-time.app/agb",
	trustCenter: "https://www.z8-time.app/trustcenter",
} as const;

export function InfoFooter() {
	const { t } = useTranslate();

	return (
		<div className="text-balance text-center text-muted-foreground text-xs">
			<div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 *:[a]:underline *:[a]:underline-offset-4 *:[a]:hover:text-primary">
				<a href={EXTERNAL_INFO_LINKS.terms} rel="noopener noreferrer">
					{t("auth.terms.service", "Terms of Service")}
				</a>
				{" · "}
				<a href={EXTERNAL_INFO_LINKS.privacy} rel="noopener noreferrer">
					{t("auth.terms.privacy", "Privacy Policy")}
				</a>
				{" · "}
				<a href={EXTERNAL_INFO_LINKS.imprint} rel="noopener noreferrer">
					{t("info.imprint", "Imprint")}
				</a>
				{" · "}
				<a href={EXTERNAL_INFO_LINKS.agb} rel="noopener noreferrer">
					{t("info.agb", "AGB")}
				</a>
				{" · "}
				<a href={EXTERNAL_INFO_LINKS.trustCenter} rel="noopener noreferrer">
					{t("info.trust-center", "Trust Center")}
				</a>
				{" · "}
				<Link href="/licenses">Open Source Licenses</Link>
			</div>
		</div>
	);
}
