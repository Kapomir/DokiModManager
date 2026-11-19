<!-- Kapomir fork modifications, 2026-11-19: Updates and logs use separate grid panels. -->
<script setup>
import version from "../version.json";
import {CLIENT_VERSION} from "./core/VersionHandler";
</script>

<template>
  <div class="updates-panel">
    <header class="updates-heading" data-tauri-drag-region>
      <div>
        <p class="updates-eyebrow">KAPOMIR · MACOS</p>
        <h1>Updates</h1>
        <p id="desktop-version">Doki Doki Mod Manager {{ CLIENT_VERSION }}</p>
      </div>
      <button id="desktop-launch" class="updates-button">Back to mods</button>
    </header>
    <section class="updates-card release-panel" aria-label="Release notes">
      <h2>This version</h2>
      <ul class="release-notes">
        <li v-for="change in version.changes" :key="change">{{ change }}</li>
      </ul>
      <p class="updates-status" id="desktop-update-status" role="status">Updates are checked against the Kapomir fork. Downloads open in your browser.</p>
      <div class="updates-actions">
        <button id="desktop-update" class="updates-button">Check for updates</button>
        <button id="desktop-releases" class="updates-button">Open fork releases</button>
      </div>
    </section>
    <section class="updates-card logs-panel" aria-label="Application log">
      <h2>Application log</h2>
      <div class="console-texts" id="console" tabindex="0"></div>
    </section>
    <footer class="updates-footer">
      <span>Original by BKunzite · Apache-2.0 · Fork by Kapomir</span>
      <div class="updates-actions">
        <button id="desktop-project" class="updates-button">Fork on GitHub</button>
        <button id="desktop-close2" class="updates-button">Quit</button>
      </div>
    </footer>
  </div>
</template>

<style src="./desktop.css"></style>
