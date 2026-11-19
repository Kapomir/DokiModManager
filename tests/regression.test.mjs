// Local macOS regression tests, 2026-11-19. Only synthetic temporary data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const main = await fs.readFile(new URL("../src/main.js", import.meta.url), "utf8");
const OS = {TYPE: {WINDOWS: "windows", LINUX: "linux", MAC: "mac"}};

async function loadModule(relative, dependencies, globals = {}) {
    const context = vm.createContext({TextEncoder, structuredClone, crypto: globalThis.crypto, ...globals});
    const module = new vm.SourceTextModule(await fs.readFile(new URL(relative, import.meta.url), "utf8"), {context});
    await module.link(specifier => {
        const exports = dependencies[specifier];
        assert.ok(exports, `Unexpected dependency ${specifier}`);
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        }, {context});
    });
    await module.evaluate();
    return module.namespace;
}

const {validateName} = await loadModule("../src/core/utils/FileSystem.js", {
    "./OSUtil": {OS, getOSType: () => OS.TYPE.MAC}
});

test("macOS accepts real mod names, spaces, Unicode, and repeated validation", () => {
    for (let repeat = 0; repeat < 3; repeat++) {
        for (const name of ["Fallen Angel", "FallenAngel", "DDFA fix", "DokiDokiBlueSkies1.0.6",
            "Purist Mod Release v1.1.1", "Zażółć gęślą jaźń", "青い空", "a".repeat(100)]) {
            assert.equal(validateName(name, "mac"), true, name);
        }
    }
});

test("rejects empty names, traversal, separators, NUL, and oversized names", () => {
    for (const name of ["", "  ", ".", "..", "../Fallen", "Fallen/Angel", "Fallen:Angel", "x\0y",
        "a".repeat(101), "青".repeat(86)]) {
        assert.equal(validateName(name, "mac"), false, name);
    }
    assert.equal(validateName(null), false);
    assert.equal(validateName("safe", "unknown"), false);
});

test("Windows and Linux retain their own filename rules", () => {
    for (const name of ["CON", "con.txt", "LPT1", "COM9.log", "name.", "name ", "a\\b", "a?b"]) {
        assert.equal(validateName(name, "windows"), false, name);
    }
    assert.equal(validateName("Fallen Angel", "windows"), true);
    assert.equal(validateName("Fallen:Angel", "linux"), true);
    assert.equal(validateName("Fallen/Angel", "linux"), false);
});

test("names containing markup or ampersands retain every character when escaped", async () => {
    const {htmlEscape, formattedHtmlEscape} = await loadModule("../src/core/utils/TextUtil.js", {});
    for (const escape of [htmlEscape, formattedHtmlEscape]) {
        assert.equal(escape("A&B"), "A&amp;B");
        assert.equal(escape("A<B"), "A&lt;B");
        assert.equal(escape("<img>"), "&lt;img&gt;");
        assert.equal(escape('A"B'), "A&quot;B");
        assert.equal(escape("Plain Name"), "Plain Name");
    }
});

function functionSource(name) {
    const start = main.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, name);
    const end = main.indexOf("\n}", start) + 2;
    return main.slice(start, end);
}

function renameHarness(overrides = {}) {
    const events = [];
    const title = {value: "Fallen Angel"};
    const hidden = new Set(["loader"]);
    const parent = "/synthetic/Mods";
    const launcher = {getFunctions: () => ({
        getName: () => "DDFA fix", getPath: async () => parent,
        leftClick: async () => events.push(["select"])
    })};
    const context = vm.createContext({
        renamingMod: false, currentEntry: "DDFA fix", fileTerminator: "/",
        STRINGS: {isEmpty: value => value === ""}, validateName,
        formatModName: value => value, getLauncher: () => launcher,
        getIsLaunchedFlag: () => false, gotoHomePage: () => events.push(["home"]),
        isExist: async target => { events.push(["exists", target]); return false; },
        invoke: async (...args) => events.push(["invoke", ...args]),
        requestDirectory: async target => events.push(["refresh", target]),
        confirm: async message => events.push(["message", message]),
        Logger: {log() {}, warn() {}},
        Hud: {ofId: () => title, show: id => hidden.delete(id), hide: id => hidden.add(id),
            setLoadingSubtitle() {}, setLoadingBar() {}}, ...overrides
    });
    vm.runInContext(functionSource("renameMod"), context);
    return {run: () => context.renameMod(), context, events, hidden, title, parent};
}

test("rename checks the exact sibling path, awaits Rust, refreshes and selects", async () => {
    const h = renameHarness();
    await h.run();
    assert.deepEqual(h.events[0], ["exists", "/synthetic/Mods/Fallen Angel"]);
    assert.equal(h.events[1][1], "rename_dir");
    assert.equal(h.events[1][2].path, "/synthetic/Mods/DDFA fix");
    assert.equal(h.events[1][2].newName, "/synthetic/Mods/Fallen Angel");
    assert.deepEqual(h.events[2], ["refresh", h.parent]);
    assert.deepEqual(h.events[3], ["select"]);
    assert.equal(h.hidden.has("loader"), true);
    assert.equal(h.hidden.has("main"), false);
    assert.equal(h.context.renamingMod, false);
});

test("duplicate target prevents the Rust command and preserves the title", async () => {
    const h = renameHarness({isExist: async () => true});
    await h.run();
    assert.equal(h.events.some(event => event[0] === "invoke"), false);
    assert.match(h.events[0][1], /already exists/);
    assert.equal(h.title.value, "DDFA fix");
});

test("a running game cannot be renamed", async () => {
    const h = renameHarness({getIsLaunchedFlag: () => true});
    await h.run();
    assert.equal(h.events.some(event => event[0] === "invoke"), false);
    assert.match(h.events[0][1], /Close the running game/);
});

test("Rust failure restores the UI without refreshing or reporting success", async () => {
    const h = renameHarness({invoke: async () => { throw new Error("permission denied"); }});
    await h.run();
    assert.equal(h.events.some(event => event[0] === "refresh"), false);
    assert.match(h.events.find(event => event[0] === "message")[1], /permission denied/);
    assert.equal(h.title.value, "DDFA fix");
    assert.equal(h.hidden.has("loader"), true);
    assert.equal(h.hidden.has("main"), false);
});

test("a list refresh failure correctly reports that the disk rename succeeded", async () => {
    const h = renameHarness({requestDirectory: async () => { throw new Error("refresh failed"); }});
    await h.run();
    assert.match(h.events.find(event => event[0] === "message")[1], /was renamed/);
    assert.equal(h.hidden.has("main"), false);
});

test("overlapping blur events cannot invoke two renames", async () => {
    let finish;
    let calls = 0;
    const h = renameHarness({invoke: async () => { calls++; await new Promise(resolve => { finish = resolve; }); }});
    const first = h.run();
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    await h.run();
    assert.equal(calls, 1);
    finish();
    await first;
});

test("cancelling the native image dialog has no file or UI mutations", async () => {
    const context = vm.createContext({importingImages: false,
        open: async () => null,
        addImagesToLibrary: () => assert.fail("cancel must not import"),
        Logger: {warn: () => assert.fail("cancel is not an error")},
        confirm: () => assert.fail("cancel must not show an error")});
    vm.runInContext(functionSource("selectImageFiles"), context);
    await context.selectImageFiles();
    assert.equal(context.importingImages, false);
});

test("custom cover metadata stores a stable filename and retains the relative executable", async () => {
    const start = main.indexOf("let saveModData = async () => {");
    const end = main.indexOf("\n    };", start) + "\n    };".length;
    assert.ok(start >= 0 && end > start);
    let written;
    const config = {coverId: 6, executable: "DDLC.app/Contents/MacOS/DDLC", time: 123};
    const context = vm.createContext({structuredClone, configData: config,
        configPath: "/synthetic/Mod/.ddmm.config.json",
        coverIdToShortMap: new Map([[6, "image-stable.svg"]]),
        writeTextFile: async (target, contents) => { written = {target, data: JSON.parse(contents)}; }});
    vm.runInContext(main.slice(start, end) + "\nglobalThis.save = saveModData;", context);
    await context.save();
    assert.equal(written.data.coverId, "image-stable.svg");
    assert.equal(written.data.executable, config.executable);
    assert.equal(written.data.time, 123);
    assert.equal(config.coverId, 6, "serialization must not mutate live state");
});

async function imageHarness(t, globals) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ddmm-images-"));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const module = await loadModule("../src/core/utils/ImageImport.js", {
        "@tauri-apps/plugin-fs": {mkdir: fs.mkdir, readFile: fs.readFile,
            writeFile: async (target, bytes, options) => {
                assert.equal(options.createNew, true, "imports must not overwrite");
                await fs.writeFile(target, bytes, {flag: "wx"});
            }},
        "./ImageFormat.js": {imageMimeType: name => /\.(png|jpg|svg)$/i.test(name) ? "image/test" : undefined,
            decodeImage: async bytes => {
                if (bytes[0] !== 137) throw new Error("invalid image");
            }}
    }, globals);
    return {root, importImages: module.importImages};
}

test("image import copies multiple files and retains source bytes and existing images", async t => {
    const {root, importImages} = await imageHarness(t);
    const library = path.join(root, "library");
    await fs.mkdir(library);
    await fs.writeFile(path.join(library, "keep.png"), "keep");
    const sources = [path.join(root, "my cover.png"), path.join(root, "my cover.JPG")];
    for (const source of sources) await fs.writeFile(source, Buffer.from([137, 0, 255, 42]));
    const result = await importImages(sources, library);
    assert.equal(result.errors.length, 0);
    assert.equal(result.imported.length, 2);
    assert.notEqual(result.imported[0], result.imported[1]);
    for (const target of [...sources, ...result.imported]) assert.deepEqual(await fs.readFile(target), Buffer.from([137, 0, 255, 42]));
    assert.equal(await fs.readFile(path.join(library, "keep.png"), "utf8"), "keep");
});

test("a filename collision never overwrites the existing cover", async t => {
    const {root, importImages} = await imageHarness(t, {crypto: {randomUUID: () => "same-id"}});
    const source = path.join(root, "cover.png");
    const library = path.join(root, "library");
    await fs.writeFile(source, Buffer.from([137, 1, 2]));
    const first = await importImages([source], library);
    await fs.writeFile(source, Buffer.from([137, 9, 9]));
    const second = await importImages([source], library);
    assert.equal(second.imported.length, 0);
    assert.equal(second.errors.length, 1);
    assert.deepEqual(await fs.readFile(first.imported[0]), Buffer.from([137, 1, 2]));
});

test("corrupt and unsupported images are reported without copying them", async t => {
    const {root, importImages} = await imageHarness(t);
    const bad = path.join(root, "broken.png");
    const library = path.join(root, "library");
    await fs.writeFile(bad, "not a png");
    const result = await importImages([bad, path.join(root, "file.exe")], library);
    assert.equal(result.imported.length, 0);
    assert.equal(result.errors.length, 2);
    await assert.rejects(fs.stat(library), {code: "ENOENT"});
    assert.equal(await fs.readFile(bad, "utf8"), "not a png");
});

const textModule = await loadModule("../src/core/utils/TextUtil.js", {});
const descriptions = await loadModule("../src/core/utils/ModDescription.js", {"./TextUtil": {htmlEscape: textModule.htmlEscape}});

test("description save preserves all existing metadata and accepts clearing", async () => {
    const config = {executable: "DDLC.app/Contents/MacOS/DDLC", coverId: "custom.svg", time: 45, extension: {keep: true}};
    const original = structuredClone(config);
    let written;
    await descriptions.updateModDescription(config, "My description\nA&B <tag>", async () => { written = structuredClone(config); });
    assert.deepEqual(written, {...original, description: "My description\nA&B <tag>"});
    await descriptions.updateModDescription(config, "", async () => {});
    assert.equal(config.description, "");
    assert.deepEqual({...config, description: undefined}, {...original, description: undefined});
});

test("description save failure restores the prior value and rejects oversized input", async () => {
    const config = {description: "keep", time: 45};
    await assert.rejects(descriptions.updateModDescription(config, "new", async () => { throw new Error("disk failure"); }));
    assert.equal(config.description, "keep");
    const empty = {time: 45};
    await assert.rejects(descriptions.updateModDescription(empty, "new", async () => { throw new Error("disk failure"); }));
    assert.equal(Object.hasOwn(empty, "description"), false);
    await assert.rejects(descriptions.updateModDescription(config, "x".repeat(10001), () => assert.fail()));
});

test("description text is escaped while the technical details remain available", () => {
    const html = descriptions.descriptionHtml('<img src=x onerror="bad()"> & B', "Ren’Py: synthetic<br>Credits: original author");
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("&lt;img"));
    assert.ok(html.includes("&amp; B"));
    assert.ok(html.includes("Game details &amp; credits"));
    assert.ok(html.includes("Credits: original author"));
});

test("fork updates compare numeric fork revisions and never offer upstream/downgrade versions", async () => {
    const {isNewerForkVersion} = await loadModule("../src/core/utils/ForkVersion.js", {});
    assert.equal(isNewerForkVersion("1.8.1-kapomir.3", "1.8.1-kapomir.2"), true);
    assert.equal(isNewerForkVersion("1.8.1-kapomir.10", "1.8.1-kapomir.2"), true);
    assert.equal(isNewerForkVersion("1.8.2-kapomir.1", "1.8.1-kapomir.2"), true);
    for (const candidate of ["1.8.1-kapomir.1", "1.8.1-kapomir.2", "1.8.2", "1.8.1-release", "invalid"]) {
        assert.equal(isNewerForkVersion(candidate, "1.8.1-kapomir.2"), false, candidate);
    }
});

test("Updates mode does not tick controls removed from the main view", async () => {
    let ticks = 0;
    const context = vm.createContext({desktopOpen: true, Logger: {tick: () => ticks++}, Hud: {tick: () => assert.fail("main UI is unmounted")}});
    vm.runInContext(functionSource("mainTicker"), context);
    await context.mainTicker();
    assert.equal(ticks, 1);
});

test("cancelling description edits does not save or mutate the mod", async () => {
    const input = {value: ""};
    let writes = 0;
    const config = {description: "keep"};
    const context = vm.createContext({currentEntry: "synthetic", savingDescription: false, descriptionTarget: null,
        getLauncher: () => ({getFunctions: () => ({getData: async () => config, setDescription: () => writes++})}),
        Hud: {ofId: () => input, show() {}, hide() {}},});
    input.focus = () => {};
    const start = main.indexOf("function closeDescriptionEditor()");
    const end = main.indexOf("\n}", start) + 2;
    vm.runInContext(functionSource("openDescriptionEditor") + "\n" + main.slice(start, end), context);
    await context.openDescriptionEditor();
    input.value = "discard this";
    context.closeDescriptionEditor();
    assert.equal(config.description, "keep");
    assert.equal(writes, 0);
    assert.equal(context.descriptionTarget, null);
});

test("version checks use the fork branch and accept a newer fork release", async () => {
    const version = JSON.parse(await fs.readFile(new URL("../version.json", import.meta.url)));
    const comparator = await loadModule("../src/core/utils/ForkVersion.js", {});
    let requested;
    const handler = await loadModule("../src/core/VersionHandler.js", {
        "./utils/Logger": {default: {warn() {}}}, "../../version.json": {default: version},
        "./utils/ForkVersion.js": {isNewerForkVersion: comparator.isNewerForkVersion}
    }, {AbortController, setTimeout, clearTimeout,
        fetch: async url => {requested = url; const next = version.version.replace(/kapomir\.(\d+)$/, (_, n) => "kapomir." + (Number(n) + 1)); return {ok: true, text: async () => next + "\nFork notes"};}});
    assert.equal(await handler.shouldUpdate(), true);
    assert.equal(requested, "https://raw.githubusercontent.com/Kapomir/DokiModManager/refs/heads/macos/current_ver.txt");
    assert.equal(handler.FORK_RELEASES_URL, "https://github.com/Kapomir/DokiModManager/releases");
});

test("a failed or foreign-channel version response falls back to the installed fork", async () => {
    const version = JSON.parse(await fs.readFile(new URL("../version.json", import.meta.url)));
    const comparator = await loadModule("../src/core/utils/ForkVersion.js", {});
    for (const fetch of [async () => {throw new Error("offline");}, async () => ({ok: true, text: async () => "1.8.2-release\nUpstream notes"})]) {
        const handler = await loadModule("../src/core/VersionHandler.js", {
            "./utils/Logger": {default: {warn() {}}}, "../../version.json": {default: version},
            "./utils/ForkVersion.js": {isNewerForkVersion: comparator.isNewerForkVersion}
        }, {AbortController, setTimeout, clearTimeout, fetch});
        assert.equal((await handler.getLatest()).split("\n")[0], version.version);
        assert.equal(await handler.shouldUpdate(), false);
    }
});

const frames = await loadModule("../src/core/utils/CoverFrame.js", {});
test("framing fills or fits a wide image without distorting its aspect ratio", () => {
    const cover = frames.normalizeFrame(null, "wide.png");
    const fill = frames.frameGeometry(180, 240, 800, 400, cover);
    assert.equal(fill.width, 480);
    assert.equal(fill.height, 240);
    assert.equal(fill.left, -150);
    const fit = frames.frameGeometry(180, 240, 800, 400, {...cover, fit: "contain"});
    assert.equal(fit.width, 180);
    assert.equal(fit.height, 90);
    assert.equal(fit.top, 75);
    const moved = frames.frameGeometry(180, 240, 800, 400, {...cover, x: 0, zoom: 2});
    assert.ok(moved.left === 0);
    assert.equal(moved.width / moved.height, 2);
    assert.equal(frames.frameGeometry(0, 240, 800, 400, cover), null);
});

test("framing clamps corrupt metadata and does not reuse a different image's crop", () => {
    const frame = frames.normalizeFrame({source: "a", zoom: Infinity, x: -30, y: 20, fit: "bad"}, "a");
    assert.deepEqual({...frame}, {source: "a", zoom: 1, x: 0, y: 1, fit: "cover"});
    const changed = frames.normalizeFrame({source: "a", zoom: 4, x: 0}, "b");
    assert.deepEqual({...changed}, {source: "b", zoom: 1, x: .5, y: .5, fit: "cover"});
});

test("saving a frame retains every other metadata field and rolls back a failed write", async () => {
    const config = {coverId: "old", time: 123, last_played: -1, executable: "DDLC", description: "keep", credits: "original"};
    const original = structuredClone(config);
    await frames.updateModCover(config, "new", {source: "new", fit: "contain", zoom: 1.25, x: .1, y: .9}, async () => {});
    assert.deepEqual({...config, coverId: "old", coverFrame: undefined}, {...original, coverFrame: undefined});
    const saved = structuredClone(config);
    await assert.rejects(frames.updateModCover(config, "other", null, async () => { throw new Error("disk full"); }));
    assert.deepEqual(structuredClone(config), saved);
    await assert.rejects(frames.updateModCover(original, "other", null, async () => { throw new Error("disk full"); }));
    assert.equal(Object.hasOwn(original, "coverFrame"), false);
    assert.equal(original.coverId, "old");
});

function launchHarness(failAt) {
    const events = [];
    const config = {time: 123, last_played: -1, coverId: "cover", renpy: "6.99"};
    const start = main.indexOf("        open: async () => {", main.indexOf("let launchPending = false"));
    const end = main.indexOf("\n\tget_time:", start);
    const open = main.slice(start, end).replace(/^\s*open: /, "").replace(/,\s*$/, "");
    const context = vm.createContext({
        launchPending: false, getIsLaunchedFlag: () => false, configData: config, gameExePath: "DDLC", modDirectory: "/fixture/mod", fileTerminator: "/", name: "fixture",
        invoke: async command => { events.push(command); if (command === failAt) throw new Error("simulated launch failure"); },
        showContainers: state => events.push(state ? "ui-restored" : "ui-hidden"),
        flagModLaunched: () => events.push("flag-set"), removeModLaunchedFlag: () => events.push("flag-cleared"),
        mainTicker: async () => {}, Hud: {isVoid: value => value == null, show() {}, hide() {}, ofId: () => ({})},
        preloadCovers: {ofCover: () => ({})}, coverIdToShortMap: new Map(), applyCoverFrame() {}, normalizeFrame() {},
        Logger: {sendEvent: async () => {}, warn() {}}, AssetsManager: {Sound: {play() {}}},
        confirm: async message => events.push(message), TranslationUtil: {of: () => "unknown"}
    });
    return {run: () => vm.runInContext(`(${open})()`, context), events, config, context};
}

test("missing Rosetta preflight never starts a game, hides UI, or marks it played", async () => {
    const h = launchHarness("check_launch");
    await h.run();
    assert.equal(h.events.includes("launch"), false);
    assert.equal(h.events.includes("flag-set"), false);
    assert.equal(h.events.includes("ui-hidden"), false);
    assert.equal(h.config.time, 123);
    assert.equal(h.config.last_played, -1);
    assert.equal(h.context.launchPending, false);
});

test("a spawn failure clears playing state and preserves play history", async () => {
    const h = launchHarness("launch");
    await h.run();
    assert.ok(h.events.indexOf("check_launch") < h.events.indexOf("ui-hidden"));
    assert.ok(h.events.includes("flag-cleared") && h.events.includes("ui-restored"));
    assert.ok(h.events.some(event => event.includes("Cannot launch this mod")));
    assert.equal(h.config.last_played, -1);
    assert.equal(h.config.time, 123);
});

test("Home framing separates portrait thumbnail from background and retains legacy position", () => {
    const config = {coverId: "logo.png", bg_offset: 35};
    const result = frames.homeFrames(config, "logo.png");
    assert.equal(result.cover.fit, "contain");
    assert.equal(result.background.fit, "cover");
    assert.equal(result.background.y, .35);
    assert.equal(result.cover.y, .5);
    assert.equal(Object.hasOwn(config, "homeCoverFrame"), false);
    assert.equal(frames.homeFrames(config, "another.png").background.y, .5);
});

test("Home saves independent crops and retains unrelated preferences", async () => {
    const config = {coverId: "old.png", theme: "YURI", extra: {keep: true}, totalTime: 123, bg_offset: 0};
    const crops = frames.homeFrames(config, "new.png");
    crops.background.zoom = 1.8; crops.background.x = .2;
    await frames.updateHomeFrames(config, "new.png", crops, async () => {});
    assert.equal(config.homeCoverFrame.zoom, 1);
    assert.equal(config.homeCoverFrame.fit, "contain");
    assert.equal(config.backgroundFrame.zoom, 1.8);
    assert.equal(config.backgroundFrame.x, .2);
    assert.equal(config.extra.keep, true);
    assert.equal(config.totalTime, 123);
    assert.equal(config.theme, "YURI");
    const reloaded = frames.homeFrames(JSON.parse(JSON.stringify(config)), "new.png");
    assert.equal(reloaded.background.zoom, 1.8);
    assert.equal(reloaded.cover.zoom, 1);
});

test("failed Home saves restore the entire config, including absence of new fields", async () => {
    const config = {coverId: "old.png", theme: "YURI", extra: {keep: true}};
    const before = structuredClone(config);
    await assert.rejects(frames.updateHomeFrames(config, "new.png", frames.homeFrames(config, "new.png"), async () => {
        config.theme = "changed by persist";
        throw new Error("disk full");
    }), /disk full/);
    assert.deepEqual(structuredClone(config), before);
});
