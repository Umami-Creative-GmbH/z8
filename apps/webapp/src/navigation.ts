import { createNavigation } from "next-intl/navigation";
import { routing } from "./i18n/routing";

// read more about next-intl library
// https://next-intl-docs.vercel.app
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);
