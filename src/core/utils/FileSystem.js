// Modified for the local macOS fixes, 2026-11-19.
import { getOSType, OS } from "./OSUtil";

export let fileTerminator = getOSType() === OS.TYPE.WINDOWS ? "\\" : "/";
const invalidCharacters = {
  windows: /[<>:"/\\|?*\u0000-\u001F]|[. ]$/,
  linux: /[/\u0000]/,
  mac: /[/:\u0000]/
};
const reservedWindowsNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const archiveRegex = /\.(zip|rar|tar|7z|gz)$/i;

export function validateName(name, os = getOSType()) {
  if (typeof name !== "string" || !name.trim() || name === "." || name === "..") return false;
  if (name.length > 100 || new TextEncoder().encode(name).length > 255) return false;
  if (!Object.hasOwn(invalidCharacters, os)) return false;
  return !invalidCharacters[os].test(name) &&
    (os !== OS.TYPE.WINDOWS || !reservedWindowsNames.test(name));
}

/**
 * Replaces \\\\ with operating-system-specific terminator.
 * @param {string} path
 * @returns {string}
 */

export function terminatePath(path) {
  return path.replace(/\\/g, fileTerminator);
}

export function supportedModPackage(selectedPath) {
  return archiveRegex.test(selectedPath) ||
    selectedPath.endsWith("scripts.rpa");
}
