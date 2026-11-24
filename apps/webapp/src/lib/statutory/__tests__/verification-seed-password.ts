/**
 * The password every login of the statutory verification seed uses (#2018): the one set in
 * `STATUTORY_SEED_PASSWORD`, or a generated one. Only a generated password is printed; a password
 * the caller chose stays out of the terminal and its scrollback.
 */
export function verificationSeedPassword(
	fromEnvironment: string | undefined,
	generate: () => string,
): { readonly password: string; readonly notice: string } {
	if (fromEnvironment) {
		return {
			password: fromEnvironment,
			notice: "Every login uses the password from STATUTORY_SEED_PASSWORD.",
		};
	}
	const password = generate();
	return { password, notice: `Password for every login: ${password}` };
}
