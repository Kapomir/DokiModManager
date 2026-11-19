// Kapomir fork modifications, 2026-11-19.
import Logger from "./utils/Logger";
import version from "../../version.json";
import {isNewerForkVersion as compareVersions} from "./utils/ForkVersion.js";

export const CLIENT_VERSION = version.version;
export const FORK_URL = `https://github.com/${version.repository}`;
export const FORK_RELEASES_URL = `${FORK_URL}/releases`;
export const VERSION_URL = `https://raw.githubusercontent.com/${version.repository}/refs/heads/${version.branch}/current_ver.txt`;
export const LOCAL_RELEASE_NOTES = `${CLIENT_VERSION}\nKapomir macOS fixes\n\n${version.changes.map(change => "- " + change).join("\n")}`;
export const isNewerForkVersion = candidate => compareVersions(candidate, CLIENT_VERSION);

export async function getLatest() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(VERSION_URL, {signal: controller.signal, cache: "no-store"});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const notes = (await response.text()).trim();
        const release = notes.split("\n")[0];
        if (!/^\d+\.\d+\.\d+-kapomir\.\d+$/.test(release)) throw new Error("Unexpected release channel");
        return notes;
    } catch (error) {
        Logger.warn("Fork version check unavailable: " + error);
        return LOCAL_RELEASE_NOTES;
    } finally {
        clearTimeout(timeout);
    }
}

export async function shouldUpdate() {
    return isNewerForkVersion((await getLatest()).split("\n")[0]);
}
