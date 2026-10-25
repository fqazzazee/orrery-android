// Offscreen pictures: a sprite (a planet, the Sun) or a whole-screen layer
// (the backdrop, the trails) drawn once and then copied each frame, as the
// extension's St.DrawingAreas are repainted only when what they show moves.

import Cairo from './cairo.js';

function canvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined')
        return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

export class Picture {
    // w, h: CSS pixels; dpr: device pixels per CSS pixel
    constructor(w, h, dpr) {
        this.w = w;
        this.h = h;
        this.dpr = dpr;
        this.canvas = canvas(Math.max(1, Math.ceil(w * dpr)), Math.max(1, Math.ceil(h * dpr)));
        this.ctx = this.canvas.getContext('2d');
        this.cr = new Cairo.Context(this.ctx);
        this.empty = true;
    }

    // Draw afresh: paint(cr, ctx) in CSS pixels on a clear picture.
    paint(paint) {
        const {ctx, dpr} = this;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.cr.reset();
        ctx.save();
        paint(this.cr, ctx);
        ctx.restore();
        this.empty = false;
    }

    clear() {
        if (this.empty)
            return;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.empty = true;
    }

    // Onto ctx with its top left at (x, y), at `scale` times its size.
    drawAt(ctx, x, y, scale = 1) {
        if (!this.empty)
            ctx.drawImage(this.canvas, x, y, this.w * scale, this.h * scale);
    }

    // Centered on (x, y).
    drawCentered(ctx, x, y, scale = 1) {
        this.drawAt(ctx, x - this.w * scale / 2, y - this.h * scale / 2, scale);
    }
}

// A small picture drawn many times, like a spacecraft's glow: painted once
// for each look and kept. Drawn straight onto the screen instead, its
// gradient's paint() would cover the whole screen, once for every craft.
const stamps = new Map();

export function stamp(key, size, dpr, paint) {
    const k = `${key} ${size} ${dpr}`;
    let picture = stamps.get(k);
    if (!picture) {
        picture = new Picture(size, size, dpr);
        picture.paint(paint);
        stamps.set(k, picture);
    }
    return picture;
}
