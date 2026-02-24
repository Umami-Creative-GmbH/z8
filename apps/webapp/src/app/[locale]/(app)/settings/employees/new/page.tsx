import { redirect } from "next/navigation";

export default function DeprecatedNewEmployeePage() {
	redirect("/settings/organizations");
}
