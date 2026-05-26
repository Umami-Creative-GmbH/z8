import type { Metadata } from "next";
import CompletePageClient from "./page-client";

export const metadata: Metadata = {
	title: "Onboarding complete | Z8",
	description: "Finish Z8 onboarding and continue to your workspace.",
};

export default function CompletePage() {
	return <CompletePageClient />;
}
