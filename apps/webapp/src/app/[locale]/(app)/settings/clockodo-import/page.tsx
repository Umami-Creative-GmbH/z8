import { redirect } from "next/navigation";

export default async function ClockodoImportPage() {
	redirect("/settings/import");
}
