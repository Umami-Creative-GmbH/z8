"use server";

import {
	processPendingInviteCode as processPendingInviteCodeInSettings,
	redeemInviteCode as redeemInviteCodeInSettings,
	storePendingInviteCode as storePendingInviteCodeInSettings,
	validateInviteCode as validateInviteCodeInSettings,
} from "@/app/[locale]/(app)/settings/organizations/invite-code-actions";

export async function validateInviteCode(code: string) {
	return validateInviteCodeInSettings(code);
}

export async function storePendingInviteCode(code: string) {
	return storePendingInviteCodeInSettings(code);
}

export async function processPendingInviteCode() {
	return processPendingInviteCodeInSettings();
}

export async function redeemInviteCode(code: string, ipAddress?: string, userAgent?: string) {
	return redeemInviteCodeInSettings(code, ipAddress, userAgent);
}
