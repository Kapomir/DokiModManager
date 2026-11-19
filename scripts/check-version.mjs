// Kapomir fork modifications, 2026-11-19.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const version = JSON.parse(fs.readFileSync('version.json')).version;
for (const file of ['package.json', 'src/package.json', 'src-tauri/tauri.conf.json', 'src-tauri/tauri.macos.conf.json', 'package-lock.json']) {
    assert.equal(JSON.parse(fs.readFileSync(file)).version, version, file);
}
assert.equal(JSON.parse(fs.readFileSync('package-lock.json')).packages[''].version, version);
assert.equal(fs.readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)[1], version);
assert.equal(fs.readFileSync('src-tauri/Cargo.lock', 'utf8').match(/name = "dokimodmanager"\nversion = "([^"]+)"/)[1], version);
for (const file of ['current_ver.txt', 'current_ver_beta.txt']) assert.equal(fs.readFileSync(file, 'utf8').split('\n')[0], version, file);
console.log(`Version metadata consistent: ${version}`);
