// The slice of GJS's Cairo API that lib/render.js uses, on an HTML canvas.
// The import map in index.html points 'cairo' here, so the drawing code the
// GNOME extension uses runs unchanged in the browser and the Android app.
//
// Cairo and the canvas differ in a few ways this papers over: Cairo's fill,
// stroke and clip clear the path; its source is one setting for fills and
// strokes alike (a color, a gradient or an image); paint() floods the clip
// with the source; and a fresh context strokes 2 units wide.

const clamp01 = x => x > 1 ? 1 : x > 0 ? x : 0;
const css = (r, g, b, a = 1) =>
    `rgba(${Math.round(clamp01(r) * 255)},${Math.round(clamp01(g) * 255)},${Math.round(clamp01(b) * 255)},${clamp01(a)})`;

class Gradient {
    constructor() {
        this.stops = [];
    }

    addColorStopRGBA(offset, r, g, b, a) {
        this.stops.push([offset, css(r, g, b, a)]);
    }

    addColorStopRGB(offset, r, g, b) {
        this.addColorStopRGBA(offset, r, g, b, 1);
    }

    _fill(gradient) {
        // Canvas wants offsets in [0, 1] and throws otherwise.
        for (const [offset, color] of this.stops)
            gradient.addColorStop(clamp01(offset), color);
        return gradient;
    }
}

class LinearGradient extends Gradient {
    constructor(x0, y0, x1, y1) {
        super();
        this.args = [x0, y0, x1, y1];
    }

    make(ctx) {
        return this._fill(ctx.createLinearGradient(...this.args));
    }
}

class RadialGradient extends Gradient {
    constructor(cx0, cy0, r0, cx1, cy1, r1) {
        super();
        this.args = [cx0, cy0, Math.max(0, r0), cx1, cy1, Math.max(0, r1)];
    }

    make(ctx) {
        return this._fill(ctx.createRadialGradient(...this.args));
    }
}

function newCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined')
        return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
}

class ImageSurface {
    constructor(_format, w, h) {
        this.canvas = newCanvas(w, h);
        this.width = w;
        this.height = h;
    }
}

const LINE_CAPS = ['butt', 'round', 'square'];

export class Context {
    // target: an ImageSurface, or a CanvasRenderingContext2D to draw on.
    constructor(target) {
        this.ctx = target instanceof ImageSurface ? target.canvas.getContext('2d') : target;
        // What save() and restore() keep beyond the canvas's own state: an
        // image as the source.
        this._image = null;
        this._stack = [];
        this.reset();
    }

    // A fresh Cairo context's defaults, as each St.DrawingArea repaint gets.
    reset() {
        const c = this.ctx;
        c.lineWidth = 2;
        c.lineCap = 'butt';
        c.lineJoin = 'miter';
        c.setLineDash([]);
        c.fillStyle = c.strokeStyle = '#000';
        c.beginPath();
        this._image = null;
    }

    $dispose() {}

    save() {
        this._stack.push(this._image);
        this.ctx.save();
    }

    restore() {
        this.ctx.restore();
        this._image = this._stack.pop() ?? null;
    }

    translate(x, y) {
        this.ctx.translate(x, y);
    }

    scale(x, y) {
        this.ctx.scale(x, y);
    }

    rotate(a) {
        this.ctx.rotate(a);
    }

    newPath() {
        this.ctx.beginPath();
    }

    moveTo(x, y) {
        this.ctx.moveTo(x, y);
    }

    lineTo(x, y) {
        this.ctx.lineTo(x, y);
    }

    closePath() {
        this.ctx.closePath();
    }

    arc(x, y, r, a0, a1) {
        this.ctx.arc(x, y, Math.max(0, r), a0, a1, false);
    }

    arcNegative(x, y, r, a0, a1) {
        this.ctx.arc(x, y, Math.max(0, r), a0, a1, true);
    }

    rectangle(x, y, w, h) {
        this.ctx.rect(x, y, w, h);
    }

    setSourceRGB(r, g, b) {
        this.setSourceRGBA(r, g, b, 1);
    }

    setSourceRGBA(r, g, b, a) {
        this._image = null;
        this.ctx.fillStyle = this.ctx.strokeStyle = css(r, g, b, a);
    }

    setSource(pattern) {
        this._image = null;
        this.ctx.fillStyle = this.ctx.strokeStyle = pattern.make(this.ctx);
    }

    setSourceSurface(surface, x, y) {
        this._image = {canvas: surface.canvas, x, y};
    }

    setLineWidth(w) {
        this.ctx.lineWidth = w;
    }

    setLineCap(cap) {
        this.ctx.lineCap = LINE_CAPS[cap] ?? 'butt';
    }

    setDash(dashes, offset = 0) {
        this.ctx.setLineDash(dashes);
        this.ctx.lineDashOffset = offset;
    }

    fill() {
        this.fillPreserve();
        this.ctx.beginPath();
    }

    fillPreserve() {
        if (this._image) {
            // An image source fills the path: clip to it and paint.
            this.ctx.save();
            this.ctx.clip();
            this._paintImage();
            this.ctx.restore();
        } else {
            this.ctx.fill();
        }
    }

    stroke() {
        this.ctx.stroke();
        this.ctx.beginPath();
    }

    clip() {
        this.ctx.clip();
        this.ctx.beginPath();
    }

    // The source over everything inside the clip; the path is left alone.
    paint() {
        if (this._image) {
            this._paintImage();
            return;
        }
        const c = this.ctx;
        const inv = c.getTransform().inverse();
        const {width: w, height: h} = c.canvas;
        const p = new Path2D();
        [[0, 0], [w, 0], [w, h], [0, h]].forEach(([x, y], i) => {
            const q = inv.transformPoint({x, y});
            if (i)
                p.lineTo(q.x, q.y);
            else
                p.moveTo(q.x, q.y);
        });
        p.closePath();
        c.fill(p);
    }

    _paintImage() {
        const {canvas, x, y} = this._image;
        this.ctx.drawImage(canvas, x, y);
    }
}

const Cairo = {
    Context,
    ImageSurface,
    LinearGradient,
    RadialGradient,
    Format: {ARGB32: 0},
    LineCap: {BUTT: 0, ROUND: 1, SQUARE: 2},
};

export default Cairo;
