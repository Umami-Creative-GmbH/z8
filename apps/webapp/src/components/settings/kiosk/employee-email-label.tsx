"use client";

import { useTranslate } from "@tolgee/react";
import { isReservedEmail } from "@/lib/auth/reserved-email";

/** An employee's email, or "Kiosk only" instead of a kiosk-only employee's placeholder address (#857). */
export function EmployeeEmailLabel({ email }: { email: string }) {
	const { t } = useTranslate();
	if (!isReservedEmail(email)) return <>{email}</>;
	return <>{t("settings.employees.kioskPin.kioskOnlyNoEmail", "Kiosk only, no email")}</>;
}
