# Z8 Timer

Windows-first employee clocking companion, built with Tauri, Rust and React. Supports clock-in/out, explicit breaks, work location, closing attribution, employee-zone day totals, offline frozen commands, protected sign-in and German/English controls.

~~~powershell
pnpm --filter desktop dev
pnpm --filter desktop tauri dev
pnpm --filter desktop test
pnpm --filter desktop tauri build --bundles "nsis,msi"
~~~

Run `pnpm --filter desktop tauri dev` from the repository root (or `pnpm tauri dev` from `apps/desktop`) to start the native app. The `desktop dev` command starts only its frontend.

Update the webapp and native app together: the server advertises online support only when it can check the captured account and organization. Use trusted HTTPS for the Z8 server. Existing organizations can clock in/out and take manual breaks while connected, without a desktop permission toggle or timekeeping migration. Online requests verify the current account, organization and employee; an unconfirmed response is retained for review and never automatically resent.

Offline capture requires a previous successful negotiation by the same server/account/organization and a server offering durable version-2 commands. Automatic idle breaks additionally require atomic break support. Clocking is paused when storage, eligibility or recovery is unresolved.

Closing the window hides it in the tray; Quit exits. Launch at sign-in and inactivity reminders are opt-in. Start Break closes work immediately. Resume starts new work; End Day during a break clears local break mode without an extra clock-out.

See the [confirmed design](../../docs/desktop-companion-design.md) and [release/QA/recovery runbook](../../docs/desktop-companion-release.md). Unsigned local installers are review artifacts. Signed release and customer pilot acceptance require the documented release-owner gates.