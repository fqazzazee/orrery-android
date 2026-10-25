// What shows when the view zooms out past the planets: the bubble of the
// solar wind, rings of light-travel time, the Oort cloud, the nearest stars,
// and where the escaping spacecraft are headed, with the years they get
// there. lib/far.js of the GNOME extension, drawn on a canvas.

import * as Astro from '../../lib/astro.js';
import * as Render from '../../lib/render.js';
import * as Text from './text.js';

const LY = 63241;   // AU in a light-year

// Spheres around the Sun, drawn as their rings in the plane of the planets.
const SHELLS = [
    {r: 90, name: 'Termination shock', rank: 5, au: true, rgb: [0.55, 0.75, 1], alpha: 0.22, dash: [3, 4]},
    {r: 120, name: 'Heliopause', rank: 0, au: true, rgb: [0.55, 0.85, 1], alpha: 0.35},
    {r: 173.1, name: '1 light-day', rank: 4, rgb: [1, 1, 1], alpha: 0.12, dash: [1, 5]},
    {r: 1212, name: '1 light-week', rank: 3, rgb: [1, 1, 1], alpha: 0.12, dash: [1, 5]},
    {r: 5260, name: '1 light-month', rank: 2, rgb: [1, 1, 1], alpha: 0.12, dash: [1, 5]},
    {r: LY, name: '1 light-year', rank: 1, rgb: [1, 1, 1], alpha: 0.14, dash: [1, 5]},
];

// The nearest stars: [name, RA, Dec (degrees), light-years].
const STARS = [
    ['Alpha Centauri', 219.902, -60.834, 4.37],
    ['Proxima Centauri', 217.429, -62.680, 4.24],
    ['Barnard’s Star', 269.452, 4.693, 5.96],
];

// Years to mark along the escaping craft's paths.
const MILESTONES = [2100, 2300, 3000, 10000, 40000];

export class FarLayer {
    constructor() {
        // The Oort cloud: a flattened inner part (the Hills cloud) and a
        // round outer shell, as fixed random points.
        const rnd = Render.seeded(1950);
        const dir = flat => {
            const z = (rnd() * 2 - 1) * (flat ? 0.45 : 1), th = rnd() * 2 * Math.PI, s = Math.sqrt(1 - z * z);
            return [s * Math.cos(th), s * Math.sin(th), z];
        };
        this._oort = [];
        for (let i = 0; i < 900; i++)
            this._oort.push([Astro.scale(dir(true), 2000 * 10 ** rnd()), 0.5 + rnd() * 0.5]);
        for (let i = 0; i < 1500; i++)
            this._oort.push([Astro.scale(dir(false), 20000 * 5 ** rnd()), 0.3 + rnd() * 0.7]);
        this._stars = STARS.map(([name, ra, dec, ly]) => ({name, ly, p: Astro.scale(Astro.equatorialToEcliptic(ra, dec), ly * LY)}));
    }

    // How much of it shows, 0 to 1, for a projection.
    static amount(proj) {
        const k = Math.max(0, Math.min(1, (proj.zoomOut - 0.02) / 0.15));
        return k * k * (3 - 2 * k);
    }

    // Draw it all: into the backdrop, under the planets.
    // trajectories: the missions, for the escaping ones' future paths.
    draw(cr, ctx, {proj, W, H, area, trajectories}) {
        const k = FarLayer.amount(proj);
        if (!k)
            return;
        this._proj = proj;
        this._W = W;
        this._H = H;
        this._area = area;
        this._craft = trajectories.filter(tr => tr.segments.some(s => s.kind === 'escape') || tr.mission.id === 'newhorizons');
        ctx.save();
        ctx.globalAlpha = k;
        this._paint(cr);
        this._labels(ctx);
        ctx.restore();
    }

    _labels(ctx) {
        const p = this._proj;
        const {left, right, top, bottom} = this._area;
        const maxR = Math.hypot(this._W, this._H) / 2;
        // Labels go where they fit on screen and clear of each other.
        const placed = [];
        const put = (style, text, x, y, color = null) => {
            const [w, h] = Text.size(ctx, style, text);
            const r = [x, y, x + w, y + h];
            if (x < left + 4 || x + w > right - 4 || y < top + 30 || y + h > bottom - 4 ||
                placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]))
                return;
            placed.push(r);
            Text.draw(ctx, style, text, x, y, color);
        };
        // Shell names where the rings cross a ray just above the right-hand
        // side; most telling first, so the others give way when crowded.
        const ang = 8 * Math.PI / 180;
        for (const s of [...SHELLS].sort((a, b) => a.rank - b.rank)) {
            const rho = p.radiusPx(s.r);
            if (rho < 40 || rho > maxR)
                continue;
            const [x, y] = this._ring(s.r, ang);
            put('far', s.au ? `${s.name.toUpperCase()} · ${s.r} AU` : s.name.toUpperCase(), x + 4, y - 14);
        }
        const region = (text, r, a) => {
            const rho = p.radiusPx(r);
            if (rho < 60 || rho > maxR * 0.95)
                return;
            put('farRegion', text, p.cx + rho * Math.cos(a), p.cy - rho * Math.sin(a) * 0.9);
        };
        region('KUIPER BELT', 44, 0.35);
        region('INNER OORT CLOUD', 6000, 0.5);
        region('OORT CLOUD · TRILLIONS OF COMETS', 45000, 0.42);
        for (const s of this._stars) {
            if (this._endOn(s.p))
                continue;
            const [x, y] = p.project(s.p);
            put('farStar', `${s.name} · ${s.ly} ly`, x + 7, y - 7);
        }
        // Years along the Voyagers' way out.
        for (const tr of this._craft.filter(t => t.mission.id.startsWith('voyager'))) {
            for (const year of MILESTONES) {
                const pos = tr.position(Astro.jd(`${year}-01-01`));
                if (!pos || this._endOn(pos))
                    continue;
                const [x, y] = p.project(pos);
                put('farYear', `${year}`, x + 5, y + 2, tr.mission.color);
            }
        }
    }

    // A point on the ring of radius r (AU) in the plane of the planets, at
    // angle a (radians, from the right, counterclockwise on screen).
    _ring(r, a) {
        const p = this._proj, rho = p.radiusPx(r);
        return [p.cx + rho * Math.cos(a), p.cy - rho * p.squash * Math.sin(a)];
    }

    // Seen nearly end-on (heading at or away from the camera), a point lands
    // near the middle, misleadingly; its label is left off.
    _endOn(q) {
        const v = this._proj.view(q), n = Astro.norm(q);
        return Math.hypot(v[0], v[1]) < 0.35 * n;
    }

    _paint(cr) {
        const p = this._proj;
        const maxR = Math.hypot(this._W, this._H);
        // The heliosheath, faintly filled, under its shells.
        const ellipse = (r, negative = false) => {
            cr.save();
            cr.translate(p.cx, p.cy);
            cr.scale(1, Math.max(0.05, p.squash));
            if (negative)
                cr.arcNegative(0, 0, p.radiusPx(r), 2 * Math.PI, 0);
            else
                cr.arc(0, 0, p.radiusPx(r), 0, 2 * Math.PI);
            cr.restore();
        };
        cr.newPath();
        ellipse(120);
        ellipse(90, true);
        cr.setSourceRGBA(0.45, 0.7, 1, 0.05);
        cr.fill();
        for (const s of SHELLS) {
            const rho = p.radiusPx(s.r);
            if (rho < 6 || rho > maxR)
                continue;
            cr.newPath();
            ellipse(s.r);
            cr.setSourceRGBA(...s.rgb, s.alpha);
            cr.setLineWidth(1);
            cr.setDash(s.dash ?? [], 0);
            cr.stroke();
        }
        cr.setDash([], 0);
        Render.drawDots(cr, this._oort.map(([q, a]) => [...p.project(q).slice(0, 2), a]), 0.45, 0.7);

        // Orbits of the farthest known worlds.
        for (const id of ['sedna', 'eris']) {
            const pts = Astro.orbitPoints(Astro.planetOrbit(id, 0)).map(q => p.project(q));
            Render.strokePath(cr, pts, Render.hexToRgb(id === 'sedna' ? '#d8806a' : '#e6e1dc'), 0.22, 1, [2, 3]);
        }

        // Where the escaping craft go from here: dashed to 40,000 AD, with
        // a tick at each milestone year.
        const now = Astro.jdNow();
        for (const tr of this._craft) {
            const rgb = Render.hexToRgb(tr.mission.color);
            const pts = [];
            for (const year of [new Date().getUTCFullYear(), 2050, 2100, 2200, 2300, 2500, 3000, 5000, 10000, 20000, 40000]) {
                const pos = tr.position(Math.max(now, Astro.jd(`${year}-01-01`)));
                if (pos)
                    pts.push(p.project(pos));
            }
            Render.strokePath(cr, pts, rgb, 0.35, 1, [3, 4]);
            if (tr.mission.id.startsWith('voyager')) {
                for (const year of MILESTONES) {
                    const pos = tr.position(Astro.jd(`${year}-01-01`));
                    if (!pos || this._endOn(pos))
                        continue;
                    const [x, y] = p.project(pos);
                    cr.setSourceRGBA(...rgb, 0.8);
                    cr.arc(x, y, 2, 0, 2 * Math.PI);
                    cr.fill();
                }
            }
        }

        // The nearest stars.
        for (const s of this._stars) {
            if (this._endOn(s.p))
                continue;
            const [x, y] = p.project(s.p);
            Render.drawStar(cr, x, y, s.name.startsWith('Alpha') ? 4 : 2.5);
        }
    }
}
