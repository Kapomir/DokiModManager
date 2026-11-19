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
    const context = vm.createContext({TextEncoder, crypto: globalThis.crypto, ...globals});
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
