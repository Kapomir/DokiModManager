// Local macOS UI regression fixture, 2026-11-19. All file I/O stays in memory.
import {createApp} from "vue";
import App from "../../src/App.vue";
import "../../src/styles.css";
import source from "../../src/main.js?raw";
import * as images from "../../src/core/utils/ImageUtils.js";
import {decodeImage, imageMimeType} from "../../src/core/utils/ImageFormat.js";
import {importImages} from "../../src/core/utils/ImageImport.js";
import {open} from "@tauri-apps/plugin-dialog";
import Hud from "../../src/core/utils/HTMLHelper.js";
import DOMBatch from "../../src/core/fragment/DOMBatch.js";

const files = new Map();
const messages = [];
let dialogSelection = null;
let selectedCover = null;
const loadedModData = {coverId: 0};
window.__TAURI_INTERNALS__ = {invoke: async (command, args, options) => {
    if (command === "plugin:dialog|open") return dialogSelection;
    if (command === "plugin:fs|mkdir") return;
    if (command === "plugin:fs|read_file") {
        if (!files.has(args.path)) throw new Error("Fixture file not found");
        return Array.from(files.get(args.path));
    }
    if (command === "plugin:fs|write_file") {
        const path = decodeURIComponent(options.headers.path);
        if (!JSON.parse(options.headers.options).createNew) throw new Error("Overwrite forbidden");
        if (files.has(path)) throw new Error("File exists");
        files.set(path, new Uint8Array(args));
        return;
    }
    throw new Error("Unexpected fixture IPC: " + command);
}};

createApp(App).mount("#app");
document.documentElement.setAttribute("os-type", "linux");
document.documentElement.setAttribute("mac-type", "mac");
Hud.hide("loader");
Hud.show("main");
for (const id of ["cove", "modtitle", "modinfo", "play", "path", "delete-save"]) Hud.show(id);
Hud.hide("covers");
Hud.ofId("modtitle").value = "Synthetic Mod With A Long Editable Name";
Hud.ofId("modinfo").textContent = "Synthetic fixture — no installed mods loaded";

const env = {
    ...images, Hud, DOMBatch, importImages, open,
    localPath: "/fixture", fileTerminator: "/", currentEntry: "synthetic",
    currentBackgroundCover: "DefaultCovers/house.webp", importingImages: false,
    STRINGS: {EMPTY: ""}, terminatePath: path => path.replaceAll("\\", "/"),
    Optional: {readDir: async directory => ({isSome: () => true, getResult: async () =>
        [...files.keys()].filter(path => path.startsWith(directory + "/"))
            .map(path => ({name: path.slice(directory.length + 1), isDirectory: false}))})},
    Logger: {warn: (...args) => messages.push(args.join(" "))},
    confirm: async message => messages.push(message),
    AssetsManager: {Sound: {play() {}}},
    setCover: async id => { selectedCover = id; },
    getLauncher: () => ({getFunctions: () => ({setCover: async id => {
        selectedCover = images.coverIdToShortMap.get(id);
        loadedModData.coverId = id;
        Hud.ofId("cove").style.backgroundImage = `url("${images.preloadCovers.ofCover(id).src}")`;
    }})}),
    getLaunchers: () => ({synthetic: {getFunctions: () => ({getData: async () => loadedModData})}})
};

const names = ["syncCovers", "updateCoverImages", "selectImageFiles", "addImagesToLibrary"];
const functions = names.map(name => {
    const start = source.indexOf(`async function ${name}(`);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}).join("\n");
const api = new Function("env", `with (env) { ${functions}; return {${names.join(",")}}; }`)(env);
Hud.onClick("importimage", api.selectImageFiles);
Hud.onClick("image-picker-import", api.selectImageFiles);
Hud.onClick("image-picker-cancel", () => {
    Hud.ofId("image-picker-bg").classList.remove("image-picker-visible");
    Hud.hide("profile-blur");
});

await api.syncCovers();
await api.updateCoverImages(true);
window.fixture = {
    files, messages, api, images, decodeImage, imageMimeType, loadedModData,
    select: paths => { dialogSelection = paths; },
    selectedCover: () => selectedCover,
    showPicker: () => {
        Hud.show("profile-blur");
        Hud.ofId("image-picker-bg").classList.add("image-picker-visible");
    }
};
window.fixtureReady = true;
