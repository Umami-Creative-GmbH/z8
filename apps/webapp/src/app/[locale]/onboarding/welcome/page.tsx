import type { Metadata } from "next";
import { WelcomePageClient } from "./page-client";

export const metadata: Metadata = {
	title: "Welcome | Z8",
	description: "Start onboarding and set up your Z8 workspace.",
};

export default function WelcomePage() {
	return <WelcomePageClient />;
}
