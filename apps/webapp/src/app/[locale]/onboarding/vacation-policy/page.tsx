import type { Metadata } from "next";
import VacationPolicyPageClient from "./page-client";

export const metadata: Metadata = {
	title: "Vacation policy setup | Z8",
	description: "Configure vacation policy defaults for absence tracking in Z8.",
};

export default function VacationPolicyPage() {
	return <VacationPolicyPageClient />;
}
