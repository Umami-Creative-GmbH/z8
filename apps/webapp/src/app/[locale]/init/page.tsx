import type { Metadata } from "next";
import InitPageClient from "./page-client";

export const metadata: Metadata = {
	title: "Initializing workspace | Z8",
	description: "Prepare your active Z8 organization before entering the workspace.",
};

export default function InitPage() {
	return <InitPageClient />;
}
