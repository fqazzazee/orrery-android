// Names drawn on the canvas: the styles of the extension's labels
// (stylesheet.css), in pixels, with their widths remembered.

const FAMILY = 'Outfit, "Google Sans", Roboto, sans-serif';

// name: [weight, px, color, letter spacing]
export const STYLES = {
    planet: [600, 10.5, 'rgba(215,222,240,0.5)'],
    planetHover: [600, 10.5, 'rgba(235,240,252,0.95)'],
    small: [600, 9.3, 'rgba(215,222,240,0.38)'],
    moon: [600, 8.7, 'rgba(215,222,240,0.5)'],
    marker: [600, 8.7, null],
    craft: [600, 10.5, null],
    edge: [600, 10.5, null],
    focusMoon: [600, 10.5, 'rgba(215,222,240,0.6)'],
    focus: [600, 10, null],
    far: [600, 9.3, 'rgba(170,210,255,0.5)', 1],
    farRegion: [600, 10, 'rgba(215,205,190,0.4)', 2],
    farStar: [400, 10.5, 'rgba(255,235,200,0.7)'],
    farYear: [600, 9.3, null],
    sunContour: [600, 10, null],
    sunZone: [600, 10, 'rgba(130,240,170,0.6)'],
};

const widths = new Map();

const font = ([weight, px]) => `${weight} ${px}px ${FAMILY}`;

export function setup(ctx, style) {
    const s = STYLES[style];
    ctx.font = font(s);
    ctx.textBaseline = 'top';
    if ('letterSpacing' in ctx)
        ctx.letterSpacing = `${s[3] ?? 0}px`;
}

// [width, height] of a label.
export function size(ctx, style, text) {
    const key = `${style}\n${text}`;
    let w = widths.get(key);
    if (w === undefined) {
        setup(ctx, style);
        w = Math.ceil(ctx.measureText(text).width);
        if (widths.size > 4000)
            widths.clear();
        widths.set(key, w);
    }
    return [w, Math.ceil(STYLES[style][1] * 1.3)];
}

// Fonts arrive after the first frames; widths measured before then are off.
export function forget() {
    widths.clear();
}

// A label with its top left at (x, y).
export function draw(ctx, style, text, x, y, color = null, alpha = 1) {
    setup(ctx, style);
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * alpha;
    ctx.fillStyle = color ?? STYLES[style][2] ?? '#fff';
    ctx.fillText(text, Math.round(x), Math.round(y));
    ctx.globalAlpha = a0;
}

// A label to place: {style, text, x, y, color, prio, w, h}, then declutter()
// drops the ones that would land on more important ones.
export function declutter(ctx, labels, taken = []) {
    const placed = [...taken];
    const out = [];
    for (const l of [...labels].sort((a, b) => a.prio - b.prio)) {
        [l.w, l.h] = size(ctx, l.style, l.text);
        const r = [l.x + 1, l.y + 2, l.x + l.w - 1, l.y + l.h - 2];
        if (l.prio > 1 && placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]))
            continue;
        placed.push(r);
        out.push(l);
    }
    return out;
}
