// Local macOS WebKit regression checks, 2026-11-19.
// Start Vite separately. Set PLAYWRIGHT_MODULE to a module URL if not installed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const {webkit} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = process.env.UI_OUTPUT_DIR || "ui-results";
await fs.mkdir(output, {recursive: true});
const browser = await webkit.launch({headless: true});
const results = [];
try {
    for (const viewport of [{width: 1200, height: 600}, {width: 1000, height: 600}, {width: 1440, height: 900}]) {
        const page = await browser.newPage({viewport, deviceScaleFactor: 2});
        const errors = [];
        page.on("pageerror", error => errors.push(String(error)));
        await page.goto((process.env.UI_BASE_URL || "http://127.0.0.1:1420") + "/tests/ui/preview.html");
        await page.waitForFunction(() => window.fixtureReady);
        await page.evaluate(() => window.fixture.showPicker());
        await page.waitForTimeout(600);
        const initial = await page.evaluate(() => {
            const f = window.fixture;
            return {count: f.images.covers.length(), dimensions: Object.values(f.images.preloadCovers.asList())
                .map(image => [image.naturalWidth, image.naturalHeight])};
        });
        assert.equal(initial.count, 6);
        assert.ok(initial.dimensions.every(([width, height]) => width > 0 && height > 0));

        // Decode real browser-produced PNG/JPEG/WebP and an SVG with the correct MIME.
        const decoded = await page.evaluate(async () => {
            const f = window.fixture;
            const canvas = document.createElement("canvas");
            canvas.width = 240; canvas.height = 120;
            canvas.getContext("2d").fillRect(0, 0, 240, 120);
            const names = [];
            for (const [extension, mime] of [["png", "image/png"], ["jpg", "image/jpeg"], ["webp", "image/webp"]]) {
                const blob = await new Promise(resolve => canvas.toBlob(resolve, mime));
                const bytes = new Uint8Array(await blob.arrayBuffer());
                await f.decodeImage(bytes, "cover." + extension);
                f.files.set("/selected/cover." + extension, bytes);
                names.push("/selected/cover." + extension);
            }
            const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="240"><rect width="120" height="240" fill="rebeccapurple"/></svg>');
            await f.decodeImage(svg, "cover.SVG");
            f.files.set("/selected/cover.SVG", svg);
            f.select([...names, "/selected/cover.SVG"]);
            return names.length + 1;
        });
        assert.equal(decoded, 4);
        await page.locator("#image-picker-import").click();
        await page.waitForFunction(() => window.fixture.images.covers.length() === 10);
        const library = await page.evaluate(() => [...window.fixture.files.keys()].filter(path => path.startsWith("/fixture/")));
        assert.equal(library.length, 4);
        await page.locator(".image-picker-cover img").last().dispatchEvent("mouseup", {button: 0});
        const selected = await page.evaluate(() => window.fixture.selectedCover());
        assert.ok(library.some(path => path.endsWith("/" + selected)));
        await page.evaluate(() => window.fixture.showPicker());
        await page.waitForTimeout(600);
        const bounds = await page.evaluate(() => {
            const rect = id => {
                const r = document.getElementById(id).getBoundingClientRect();
                return {x: r.x, y: r.y, right: r.right, bottom: r.bottom};
            };
            const items = document.getElementById("image-picker-items");
            return {picker: rect("image-picker-bg"), importButton: rect("image-picker-import"),
                cancelButton: rect("image-picker-cancel"), scrollWidth: items.scrollWidth, clientWidth: items.clientWidth,
                editableSelection: (getComputedStyle(document.getElementById("modtitle")).webkitUserSelect || getComputedStyle(document.getElementById("modtitle")).userSelect)};
        });
        assert.ok(bounds.picker.x >= 0 && bounds.picker.y >= 0);
        assert.ok(bounds.picker.right <= viewport.width && bounds.picker.bottom <= viewport.height);
        assert.ok(bounds.importButton.right <= bounds.cancelButton.x);
        assert.ok(bounds.cancelButton.right <= bounds.picker.right);
        assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, "No horizontal clipping in picker");
        assert.equal(bounds.editableSelection, "text");
        await page.screenshot({path: path.join(output, `webkit-picker-${viewport.width}x${viewport.height}.png`)});

        // Corrupt existing library files must not break the picker or its dimensions.
        await page.evaluate(async () => {
            const f = window.fixture;
            f.files.set("/fixture/store/images/broken.png", new Uint8Array([1, 2, 3]));
            await f.api.updateCoverImages();
        });
        assert.equal(await page.locator(".image-picker-cover").count(), 10);
        const identity = await page.evaluate(() => ({
            stored: window.fixture.loadedModData.coverId,
            resolved: !!window.fixture.images.preloadCovers.ofCover(window.fixture.loadedModData.coverId)
        }));
        assert.equal(identity.stored, selected, "Library refresh must retain the selected cover identity");
        assert.equal(identity.resolved, true, "Stable filenames must resolve in both the mod and playing-game cover");
        assert.deepEqual(errors, []);
        results.push({viewport, imagesDecoded: decoded, imported: library.length, selected, bounds, errors});
        await page.close();
    }
    await fs.writeFile(path.join(output, "webkit-results.json"), JSON.stringify(results, null, 2));
    console.log(`PASS: WebKit at ${results.map(r => `${r.viewport.width}×${r.viewport.height}`).join(", ")}; real image decoding, import, selection, invalid images, and layout.`);
} finally {
    await browser.close();
}
