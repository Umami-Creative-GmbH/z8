import type { Metadata } from "next";
import ProfilePageClient from "./page-client";

export const metadata: Metadata = {
	title: "Profile setup | Z8",
	description: "Complete your personal profile details for your Z8 workspace.",
};

export default function ProfilePage() {
	return <ProfilePageClient />;
}
