// Kapomir fork modifications, 2026-11-19.
import {applyCoverFrame, frameGeometry, normalizeFrame} from "./CoverFrame.js";

export class CoverCropEditor {
    constructor() {
        this.root = document.getElementById("cover-crop-editor");
        this.stage = document.getElementById("crop-stage");
        this.thumbnail = document.getElementById("crop-thumbnail");
        this.controls = Object.fromEntries(["fit", "zoom", "x", "y"].map(key => [key, document.getElementById(`crop-${key}`)]));
        for (const [key, control] of Object.entries(this.controls)) control.addEventListener("input", () => {
            this.frame[key] = key === "fit" ? control.value : Number(control.value);
            this.render();
        });
        document.getElementById("crop-reset").addEventListener("click", () => {
            this.frame = normalizeFrame(null, this.source);
            this.render();
        });
        document.getElementById("crop-cancel").addEventListener("click", () => this.close());
        document.getElementById("crop-save").addEventListener("click", () => this.save());
        this.root.addEventListener("keydown", event => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); this.save(); }
            if (event.key === "Tab") {
                const controls = [...this.root.querySelectorAll("button, input, select")].filter(control => !control.disabled);
                const first = controls[0], last = controls.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });
        this.stage.addEventListener("pointerdown", event => {
            if (this.saving || event.button !== 0) return;
            this.drag = {x: event.clientX, y: event.clientY, frame: {...this.frame},
                geometry: frameGeometry(this.stage.clientWidth, this.stage.clientHeight, this.image.naturalWidth, this.image.naturalHeight, this.frame)};
            this.stage.setPointerCapture(event.pointerId);
        });
        this.stage.addEventListener("pointermove", event => {
            if (!this.drag || this.saving) return;
            const {geometry, frame, x, y} = this.drag;
            const dx = this.stage.clientWidth - geometry.width, dy = this.stage.clientHeight - geometry.height;
            this.frame.x = Math.abs(dx) > 1 ? Math.max(0, Math.min(1, frame.x + (event.clientX - x) / dx)) : .5;
            this.frame.y = Math.abs(dy) > 1 ? Math.max(0, Math.min(1, frame.y + (event.clientY - y) / dy)) : .5;
            this.render();
        });
        for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) this.stage.addEventListener(event, () => { this.drag = null; });
    }

    open({image, source, frame, aspect, onSave, onClose}) {
        if (this.saving) return;
        this.image = image;
        this.source = source;
        this.frame = normalizeFrame(frame, source);
        this.onSave = onSave;
        this.onClose = onClose;
        this.returnFocus = document.activeElement;
        this.root.style.setProperty("--crop-aspect", aspect);
        this.root.classList.remove("hide");
        document.getElementById("image-picker-bg").inert = true;
        document.getElementById("crop-error").textContent = "";
        this.render();
        this.controls.fit.focus();
    }

    render() {
        for (const [key, control] of Object.entries(this.controls)) control.value = this.frame[key];
        document.getElementById("crop-zoom-value").textContent = `${Math.round(this.frame.zoom * 100)}%`;
        for (const element of [this.stage, this.thumbnail]) applyCoverFrame(element, this.image, this.frame);
    }

    close() {
        if (this.saving) return;
        this.root.classList.add("hide");
        document.getElementById("image-picker-bg").inert = false;
        this.drag = null;
        for (const element of [this.stage, this.thumbnail]) element._coverResizeObserver?.disconnect();
        this.onClose?.();
        if (this.returnFocus?.isConnected) this.returnFocus.focus();
    }

    async save() {
        if (this.saving) return;
        this.saving = true;
        const controls = [...this.root.querySelectorAll("button, input, select")];
        controls.forEach(control => { control.disabled = true; });
        document.getElementById("crop-error").textContent = "";
        try {
            await this.onSave({...this.frame});
            this.saving = false;
            this.close();
        } catch (error) {
            document.getElementById("crop-error").textContent = `Cannot save crop: ${error}`;
        } finally {
            this.saving = false;
            controls.forEach(control => { control.disabled = false; });
        }
    }
}
