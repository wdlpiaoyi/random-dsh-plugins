/**
 * settings-tweaks — Host half.
 *
 * Deliberately empty: every behaviour lives in the Client half (`client.js`),
 * which wraps two shipped slot entries and adds one Settings row. This file
 * exists so the package has a Host entry point at all, because the host's
 * client-module scan resolves a Loader row's specifier to a package root and
 * reads `dsh.client` from there.
 */

/** No Host-side services, tools or routes are contributed. */
export function apply() {}
