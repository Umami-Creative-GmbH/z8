import type { Metadata } from "next";
import NotificationsPageClient from "./page-client";

export const metadata: Metadata = {
	title: "Notification setup | Z8",
	description: "Configure notification preferences for your Z8 workspace onboarding.",
};

export default function NotificationsPage() {
	return <NotificationsPageClient />;
}
