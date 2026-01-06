"use client";

import { useTranslate } from "@tolgee/react";
import { Link } from "@/navigation";

export function InfoFooter() {
	const { t } = useTranslate();
	return (
		<div className="text-balance text-center text-muted-foreground text-xs *:[a]:underline *:[a]:underline-offset-4 *:[a]:hover:text-primary">
			<Link href="/terms">{t("auth.terms.service", "Terms of Service")}</Link>
			{" · "}
			<Link href="/privacy">{t("auth.terms.privacy", "Privacy Policy")}</Link>
		</div>
	);
}
