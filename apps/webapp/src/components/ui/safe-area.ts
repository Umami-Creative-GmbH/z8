/**
 * Vertical padding for full pages whose document scrolls (sign-in, onboarding, `/init`).
 *
 * The store app shell draws edge to edge (`viewport-fit=cover`, iOS `contentInset: "never"`),
 * so the page itself must clear the notch and the home indicator (#846). The top keeps the
 * page's normal 1rem (1.5rem from `sm`) and grows to the inset where there is one; the bottom
 * adds the inset, which is 0 outside the shell.
 */
export const pageSafeAreaPaddingClassName =
	"pt-[max(1rem,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)] sm:pt-[max(1.5rem,env(safe-area-inset-top))]";
