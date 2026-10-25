// A close-up of one planet: the planet large in the middle, turned the way
// it really faces, with its moons where they really are, the satellites and
// spacecraft circling it, and the landing sites on its surface. The same
// as lib/focus.js in the GNOME extension, drawn on a canvas.
//
// Near the planet the scale is true (low orbits skim the surface, rings keep
// their size); farther out it turns logarithmic, so the outer moons, the
// geostationary belt or Juno's long loops still fit on screen.

import * as Astro from '../../lib/astro.js';
import {BODY, GM, moonsOf} from '../../lib/bodies.js';
import * as Render from '../../lib/render.js';
import {LANDERS, MISSION_ORBITS, SATELLITES, orbitOf} from '../../lib/satellites.js';
import {Picture} from './sprite.js';
import * as Text from './text.js';

const LOG_K = 0.25;
const MIN_LAP_SECONDS = 4;       // the quickest orbit takes at least this long
const MIN_SPIN_SECONDS = 20;     // and the planet turns no faster than this
const L_KM = 1.5e6;              // Sun-Earth L1 and L2 from Earth

const hashUnit = name => {
    let h = 2166136261;
    for (const c of name)
        h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0) / 4294967296;
};

export class PlanetView {
    // ctx: {view(v), area {left, right, top, bottom}, W, H, dpr, trajectories, showLabels}
    constructor(id, ctx) {
        this.id = id;
        this._ctx = ctx;
        this._body = BODY[id];
        const {left, right, top, bottom} = ctx.area;
        this.cx = (left + right) / 2;
        this.cy = (top + bottom) / 2;
        this._minDim = Math.min(right - left, bottom - top);
        this._pole = Astro.equatorialToEcliptic(...this._body.pole);
        this._poleView = Astro.unit(ctx.view(this._pole));
        this._orbits = new Picture(ctx.W, ctx.H, ctx.dpr);
        this._build();
    }

    destroy() {
        this.items = [];
    }

    // ---- Scale ----

    // Planet radii -> screen radii: true out to x0, logarithmic beyond.
    _m(x) {
        return x <= this._x0 ? x : this._x0 * (1 + LOG_K * Math.log(x / this._x0));
    }

    // A vector from the planet's center (km, ecliptic) -> [x, y, depth].
    _place(v) {
        const r = Astro.norm(v);
        if (!r)
            return [this.cx, this.cy, 0];
        const d = this._ctx.view(v);
        const px = this.RF * this._m(r / this._body.radiusKm) / r;
        return [this.cx + d[0] * px, this.cy - d[1] * px, d[2] * px];
    }

    // ---- Building ----

    _build() {
        const id = this.id, Rkm = this._body.radiusKm;
        const rings = Render.RINGS[id];
        this._x0 = Math.max(2.5, rings ? rings.at(-1)[1] + 0.25 : 0);
        this.items = [];

        for (const m of moonsOf(id))
            this.items.push({id: m.id, kind: 'moon', name: m.name.replace(/^The /, ''), color: m.color, moon: m, reach: m.a});
        for (const s of SATELLITES.filter(x => x.planet === id)) {
            const orbit = {...orbitOf(s.orbit, id), peri: 360 * hashUnit(`${s.id}w`)};
            const item = {id: s.id, kind: s.planes ? 'swarm' : 'sat', name: s.short ?? s.name, color: s.color, data: s,
                from: Astro.jd(s.from), to: s.to ? Astro.jd(s.to) : Infinity, reach: orbit.a * (1 + orbit.e)};
            item.orbits = [];
            const planes = s.planes ?? 1, per = s.perPlane ?? 1;
            for (let k = 0; k < planes; k++) {
                for (let j = 0; j < per; j++) {
                    const o = {...orbit, node: (orbit.node ?? 0) + 360 * k / planes, phase: 360 * (j / per + k / (planes * per)) + 360 * hashUnit(s.id)};
                    o.frame = Astro.satelliteFrame(o, this._pole);
                    item.orbits.push(o);
                }
            }
            this.items.push(item);
        }
        for (const l of LANDERS.filter(x => x.planet === id))
            this.items.push({id: l.id, kind: 'lander', name: l.name, color: '#f2d6a0', data: l, from: Astro.jd(l.from), to: Infinity, reach: Rkm});
        if (id === 'earth') {
            for (const lp of ['l1', 'l2'])
                this.items.push({id: lp, kind: 'lpoint', name: lp.toUpperCase(), color: '#9fb4d8', reach: L_KM});
        }
        // Spacecraft from the mission list that stay here (or at L1/L2).
        for (const tr of this._ctx.trajectories) {
            for (const seg of tr.segments.filter(sg => sg.kind === 'stay')) {
                const here = seg.body === id || id === 'earth' && (seg.body === 'l1' || seg.body === 'l2');
                if (!here)
                    continue;
                const m = tr.mission;
                const spec = MISSION_ORBITS[`${m.id}:${id}`] ?? MISSION_ORBITS[m.id];
                const item = {id: `tr:${m.id}`, kind: 'mission', tr, seg, name: m.short ?? m.name, color: m.color,
                    from: seg.t0, to: Math.min(seg.t1, tr.end), at: seg.body};
                if (spec?.follow) {
                    item.follow = spec.follow;
                } else if (seg.body === id) {
                    const o = {...orbitOf(spec ?? {peri: Rkm * 0.5, apo: Rkm * 3, i: 20, node: 360 * hashUnit(m.id)}, id), peri: 360 * hashUnit(`${m.id}w`)};
                    o.phase = 360 * hashUnit(`${m.id}p`);
                    o.frame = Astro.satelliteFrame(o, this._pole);
                    item.orbits = [o];
                    item.reach = o.a * (1 + o.e);
                }
                this.items.push(item);
            }
        }

        // Spacecraft passing by (or arriving, or landing): a hyperbola from
        // the way they come in and go out.
        for (const tr of this._ctx.trajectories.filter(x => !x.lunar)) {
            for (const ev of tr.events.filter(e => e.at === id && e.t > tr.launch + 5)) {
                const before = tr.segmentAt(ev.t - 1e-3);
                const landing = ev.kind === 'end' && before && before.kind !== 'stay';
                if (ev.kind !== 'flyby' && ev.kind !== 'arrive' && !landing)
                    continue;
                const pass = this._pass(tr, ev, ev.kind === 'flyby');
                if (!pass)
                    continue;
                const m = tr.mission;
                this.items.push({id: `pass:${m.id}:${ev.t}`, kind: 'mission', tr, pass, name: m.short ?? m.name, color: m.color,
                    from: ev.t - pass.window, to: ev.kind === 'flyby' ? ev.t + pass.window : ev.t, reach: 0});
            }
        }

        // Missions to the Moon, on their way there and back and around it.
        if (id === 'earth') {
            for (const tr of this._ctx.trajectories.filter(x => x.lunar)) {
                const m = tr.mission;
                this.items.push({id: `tr:${m.id}`, kind: 'mission', lunar: true, tr, name: m.short ?? m.name, color: m.color,
                    from: tr.launch, to: tr.end, legs: tr.path()});
            }
        }

        // Size the planet so the farthest thing fits.
        const reach = Math.max(Rkm * 3, ...this.items.map(item => item.reach ?? 0));
        this.RF = Math.max(0.07 * this._minDim, Math.min(0.17 * this._minDim, 0.45 * this._minDim / this._m(reach / Rkm)));

        this._moon = this.items.find(x => x.id === 'moon');
        const size = 2 * Render.spriteExtent(id, this.RF);
        this._size = size;
        this._planet = new Picture(size, size, this._ctx.dpr);
        for (const item of this.items) {
            item.rgb = Render.hexToRgb(item.color);
            if (item.kind === 'moon') {
                item.R = Math.max(this.RF * item.moon.radiusKm / Rkm, 2.2 + 3.2 * Math.sqrt(item.moon.radiusKm / 2634));
                item.size = Math.ceil(2 * item.R + 2);
            } else if (item.kind === 'swarm') {
                item.R = 2;
                item.size = 5;
            } else if (item.kind === 'lpoint') {
                item.R = 4;
                item.size = 11;
            } else if (item.kind === 'lander') {
                item.R = 3;
                item.size = 7;
            } else {
                item.R = 4;
                item.size = 9;
            }
            item.spots = [];
            item.hasLabel = this._ctx.showLabels || item.kind !== 'lander';
        }
    }

    // A pass by the planet: the hyperbola that bends the velocity the craft
    // comes in with (relative to the planet) into the one it leaves with,
    // closest at the time of the event. Arrivals and landings use the way
    // in only. km and days; window: days either side it is in view.
    _pass(tr, ev, out) {
        const gm = GM[this.id], R = this._body.radiusKm;
        if (!gm)
            return null;
        const kms = (a, b, dt) => Astro.scale(Astro.sub(b, a), Astro.AU_KM / (dt * Astro.DAY_S));
        const vp = kms(Astro.planetPosition(this.id, ev.t - 0.25), Astro.planetPosition(this.id, ev.t + 0.25), 0.5);
        const p0 = tr.position(ev.t - 1.5), p1 = tr.position(ev.t - 0.5);
        if (!p0 || !p1)
            return null;
        const vin = Astro.sub(kms(p0, p1, 1), vp);
        const p2 = out ? tr.position(ev.t + 0.5) : null, p3 = out ? tr.position(ev.t + 1.5) : null;
        const vout = p2 && p3 ? Astro.sub(kms(p2, p3, 1), vp) : null;
        const vinf = vout ? (Astro.norm(vin) + Astro.norm(vout)) / 2 : Astro.norm(vin);
        if (vinf < 0.1)
            return null;
        const a = gm / (vinf * vinf);
        let rp;
        if (ev.alt) {
            rp = R + ev.alt;
        } else if (vout) {
            // The turn sets how close it came: sin(turn / 2) = 1 / e.
            const turn = Math.acos(Math.max(-1, Math.min(1, Astro.dot(Astro.unit(vin), Astro.unit(vout)))));
            rp = a * (1 / Math.max(1e-3, Math.sin(turn / 2)) - 1);
        } else {
            // Arriving: low over the orbit it settles into; landing: down to
            // the ground.
            const spec = MISSION_ORBITS[`${tr.mission.id}:${this.id}`] ?? MISSION_ORBITS[tr.mission.id];
            rp = ev.kind === 'end' ? R : R + (spec?.peri ?? spec?.alt ?? R * 0.3);
        }
        rp = Math.max(R * (ev.kind === 'end' ? 1 : 1.1), Math.min(R * 40, rp));
        const e = 1 + rp / a;
        const ui = Astro.unit(vin);
        let n, p;
        if (vout && Astro.norm(Astro.cross(vin, vout)) > 1e-6 * vinf * vinf) {
            n = Astro.unit(Astro.cross(vin, vout));
            p = Astro.unit(Astro.sub(ui, Astro.unit(vout)));
        } else {
            const c = Astro.cross(ui, this._pole);
            n = Astro.unit(Astro.norm(c) > 1e-6 ? c : Astro.cross(ui, [1, 0, 0]));
            // The way in meets periapsis at acos(1 / e) to it.
            p = Astro.rotateAbout(ui, n, -Math.acos(1 / e) * 180 / Math.PI);
        }
        const q = Astro.cross(n, p);
        // In view out to the farthest of the moons and orbits, or 40 radii.
        const reach = Math.max(R * 40, ...this.items.map(item => item.reach ?? 0)) * 1.1;
        const F = Math.acosh((1 + reach / a) / e);
        const nh = Math.sqrt(gm / a ** 3);
        const window = Math.min(30, (e * Math.sinh(F) - F) / nh / Astro.DAY_S);
        return {a, e, p, q, nh, t: ev.t, window};
    }

    // The hyperbolic anomaly at a date.
    _passAnomaly(pass, jd) {
        const {e, nh, t} = pass;
        const M = nh * (jd - t) * Astro.DAY_S;
        let F = Math.asinh(M / e);
        for (let k = 0; k < 30; k++) {
            const step = (e * Math.sinh(F) - F - M) / (e * Math.cosh(F) - 1);
            F -= step;
            if (Math.abs(step) < 1e-12)
                break;
        }
        return F;
    }

    _passPoint(pass, jd, F = this._passAnomaly(pass, jd)) {
        const {a, e, p, q} = pass;
        const x = a * (e - Math.cosh(F)), y = a * Math.sqrt(e * e - 1) * Math.sinh(F);
        return Astro.add(Astro.scale(p, x), Astro.scale(q, y));
    }

    // How fast time runs here (simulated seconds per second): the quickest
    // orbit takes MIN_LAP_SECONDS, and the planet turns no faster than once
    // in MIN_SPIN_SECONDS.
    get rate() {
        let fastest = Infinity;
        for (const item of this.items) {
            if (item.kind === 'moon')
                fastest = Math.min(fastest, Math.abs(item.moon.period) * Astro.DAY_S);
            else if (item.orbits?.length)
                fastest = Math.min(fastest, Astro.satellitePeriodS(item.orbits[0].a, GM[this.id]));
        }
        const spin = Math.abs(this._body.rotationHours) * 3600 / MIN_SPIN_SECONDS;
        const lap = isFinite(fastest) ? fastest / MIN_LAP_SECONDS : spin;
        return Math.max(1, Math.min(lap, spin));
    }

    // ---- Every frame ----

    update(jd) {
        const id = this.id, gm = GM[id];
        const planetPos = Astro.planetPosition(id, jd);
        // Turn the planet and light it.
        const light = Astro.unit(this._ctx.view(Astro.scale(planetPos, -1)));
        let repaint = false;
        if (!this._light || Astro.dot(light, this._light) < 0.99999) {
            this._light = light;
            repaint = true;
        }
        const phase = Render.phaseFor(this._poleView, Astro.unit(this._ctx.view(Astro.primeMeridian(id, jd, this._body.pole))));
        if (this._phase === undefined || Math.abs(Math.atan2(Math.sin(phase - this._phase), Math.cos(phase - this._phase))) * this.RF > 0.6) {
            this._phase = phase;
            repaint = true;
        }
        if (repaint)
            this._paintPlanet();

        const sunDir = Astro.unit(Astro.scale(planetPos, -1));
        const [e1, e2] = Astro.planeBasis(this._pole);
        let visibleKey = '';
        for (const item of this.items) {
            const on = item.from === undefined || jd >= item.from && jd < item.to;
            item.on = on;
            visibleKey += on ? '1' : '0';
            if (!on)
                continue;
            const spots = [];
            if (item.kind === 'moon' && item.id === 'moon') {
                spots.push(this._place(Astro.moonPosition(jd)));
            } else if (item.kind === 'moon') {
                const a = Astro.moonAngle(item.moon, jd);
                spots.push(this._place(Astro.scale(Astro.add(Astro.scale(e1, Math.cos(a)), Astro.scale(e2, Math.sin(a))), item.moon.a)));
            } else if (item.kind === 'lpoint') {
                spots.push(this._place(Astro.scale(sunDir, item.id === 'l1' ? L_KM : -L_KM)));
            } else if (item.kind === 'lander') {
                const p = Render.surfacePoint(this._poleView, this._phase, item.data.lat, item.data.lon);
                spots.push([this.cx + p[0] * this.RF, this.cy - p[1] * this.RF, p[2] > 0.05 ? 1e6 : -1e6]);
            } else if (item.pass) {
                spots.push(this._place(this._passPoint(item.pass, jd)));
            } else if (item.lunar) {
                const moon = this._moon;
                const p = item.tr.screen(jd, {place: v => this._place(v), moon: [moon.x, moon.y, moon.depth], R: moon.R,
                    view: v => this._ctx.view(v)});
                spots.push(p ?? [this.cx, this.cy, -1e6, true]);
            } else if (item.kind === 'mission' && item.at !== id) {
                // Looping around L1 or L2.
                const lp = this.items.find(x => x.id === item.at);
                const ang = jd * 2 * Math.PI / 180 + 2 * Math.PI * hashUnit(item.id);
                const rr = 9 + 4 * hashUnit(`${item.id}r`);
                spots.push([(lp.x ?? this.cx) + rr * Math.cos(ang), (lp.y ?? this.cy) + rr * 0.55 * Math.sin(ang), 1]);
            } else if (item.follow) {
                const m = this.items.find(x => x.id === item.follow);
                const ang = jd * 2 * Math.PI / 0.3 + 1;
                spots.push([(m?.x ?? this.cx) + 8 * Math.cos(ang), (m?.y ?? this.cy) + 5 * Math.sin(ang), (m?.depth ?? 0) + 1]);
            } else {
                for (const o of item.orbits)
                    spots.push(this._place(Astro.satellitePosition(o, this._pole, gm, jd)));
            }
            item.spots = spots.map(([x, y, depth]) => ({
                x, y,
                front: item.kind === 'lander' ? depth > 0 : depth >= 0 || Math.hypot(x - this.cx, y - this.cy) > this.RF * 1.02,
            }));
            [item.x, item.y, item.depth] = spots[0];
            item.hidden = item.kind === 'lander' && spots[0][2] < 0 || !!spots[0][3];
        }
        if (visibleKey !== this._visibleKey) {
            this._visibleKey = visibleKey;
            this._paintOrbits();
        }
    }

    _paintPlanet() {
        const id = this.id, r = this.RF, size = this._size, pole = this._poleView;
        this._planet.paint(cr => {
            if (Render.RINGS[id])
                Render.drawRings(cr, size, id, r, pole, -1);
            if (!this._cache)
                this._cache = Render.bandCache(id, size, r, pole, this._ctx.dpr);
            Render.drawSurface(cr, size, id, r, {pole, phase: this._phase ?? 0, cache: this._cache});
            Render.drawShade(cr, size, r, this._light ?? [1, 0, 0], this._body.atmosphere);
            if (Render.RINGS[id])
                Render.drawRings(cr, size, id, r, pole, +1);
        });
    }

    // Names, placed beside their things; less important ones give way.
    placeLabels(ctx, featured) {
        const placed = [[this.cx - this.RF, this.cy - this.RF, this.cx + this.RF, this.cy + this.RF]];
        const order = [...this.items].sort((a, b) => (featured(b) - featured(a)) || (rank(a) - rank(b)));
        this._labels = [];
        for (const item of order) {
            if (!item.hasLabel || !item.on || item.hidden || (item.kind === 'lander' && !featured(item)))
                continue;
            const style = item.kind === 'moon' ? 'focusMoon' : 'focus';
            const text = item.kind === 'moon' ? item.name.toUpperCase() : item.name;
            const [w, h] = Text.size(ctx, style, text);
            const x = Math.round(item.x + item.R + 3), y = Math.round(item.y - h / 2);
            const r = [x, y, x + w, y + h];
            // Low orbits are over the planet anyway; only moons keep off it.
            const others = item.kind === 'moon' ? placed : placed.slice(1);
            const clash = others.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
            if (featured(item) || !clash) {
                this._labels.push({style, text, x, y, color: item.kind === 'moon' ? null : item.color});
                placed.push(r);
            }
        }
    }

    _paintOrbits() {
        this._orbits.paint(cr => {
            const ring = pts => {
                if (pts.length < 2)
                    return;
                cr.moveTo(pts[0][0], pts[0][1]);
                for (const [x, y] of pts.slice(1))
                    cr.lineTo(x, y);
            };
            const [e1, e2] = Astro.planeBasis(this._pole);
            cr.setLineWidth(0.9);
            for (const item of this.items) {
                if (!item.on)
                    continue;
                const rgb = item.rgb;
                if (item.kind === 'moon') {
                    const [b1, b2] = item.moon.ecliptic ? Astro.planeBasis([0, 0, 1]) : [e1, e2];
                    ring(Array.from({length: 121}, (_, i) => {
                        const a = i / 120 * 2 * Math.PI;
                        return this._place(Astro.scale(Astro.add(Astro.scale(b1, Math.cos(a)), Astro.scale(b2, Math.sin(a))), item.moon.a));
                    }));
                    cr.setSourceRGBA(0.8, 0.84, 0.92, 0.16);
                    cr.stroke();
                } else if (item.pass) {
                    const {t, window} = item.pass;
                    // Even steps along the curve, not in time: the bend near
                    // the planet takes minutes of a days-long pass.
                    const F0 = this._passAnomaly(item.pass, t - window);
                    const F1 = item.to > t ? -F0 : 0;
                    ring(Array.from({length: 161}, (_, k) => this._place(this._passPoint(item.pass, 0, F0 + (F1 - F0) * k / 160))));
                    cr.setSourceRGBA(...rgb, 0.3);
                    cr.stroke();
                } else if (item.legs) {
                    // The legs to the Moon and back, up to where they join it.
                    for (const leg of item.legs) {
                        ring(leg.filter(q => q.w < 0.9).map(q => this._place(q.p)));
                        cr.setSourceRGBA(...rgb, 0.3);
                        cr.stroke();
                    }
                } else if (item.orbits && item.kind !== 'lander') {
                    const seen = new Set();
                    for (const o of item.orbits) {
                        // One path per plane for constellations.
                        const key = Math.round(o.node);
                        if (seen.has(key))
                            continue;
                        seen.add(key);
                        ring(Array.from({length: 121}, (_, i) => {
                            const E = i / 120 * 2 * Math.PI;
                            const x = o.a * (Math.cos(E) - o.e), y = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
                            return this._place(Astro.add(Astro.scale(o.frame.p, x), Astro.scale(o.frame.q, y)));
                        }));
                        cr.setSourceRGBA(...rgb, item.kind === 'swarm' ? 0.07 : 0.22);
                        cr.stroke();
                    }
                }
            }
        });
    }

    // Everything, back to front: orbits, what is behind the planet, the
    // planet, what is in front, then the names.
    draw(ctx, cr) {
        this._orbits.drawAt(ctx, 0, 0);
        const sprites = front => {
            for (const item of this.items) {
                if (!item.on || (item.lunar && item.hidden))
                    continue;
                item.spots.forEach(({x, y, front: f}) => {
                    if (f !== front || (item.kind === 'lander' && !f))
                        return;
                    const s = item.size;
                    cr.save();
                    cr.translate(Math.round(x - s / 2), Math.round(y - s / 2));
                    if (item.kind === 'moon')
                        Render.drawMoon(cr, s, item.rgb, this._light ?? [1, 0, 0]);
                    else if (item.kind === 'swarm' || item.kind === 'lander')
                        Render.drawSpeck(cr, s, item.rgb);
                    else if (item.kind === 'lpoint')
                        Render.drawMarker(cr, s, item.rgb, 0.6);
                    else
                        Render.drawCraft(cr, s, item.rgb);
                    cr.restore();
                    cr.newPath();
                });
            }
        };
        sprites(false);
        this._planet.drawCentered(ctx, this.cx, this.cy);
        sprites(true);
        for (const l of this._labels ?? [])
            Text.draw(ctx, l.style, l.text, l.x, l.y, l.color);
    }

    // ---- Picking ----

    hitTest(x, y, reach = 6) {
        let best = null, bestD = Infinity;
        for (const item of this.items) {
            if (!item.on || item.hidden)
                continue;
            for (const s of item.spots) {
                const d = Math.hypot(x - s.x, y - s.y);
                if (d < Math.max(reach, item.R + 3) && d < bestD)
                    [best, bestD] = [item, d];
            }
        }
        if (best)
            return best.tr ? {tr: best.tr} : {id: best.id};
        if (Math.hypot(x - this.cx, y - this.cy) < this.RF + 4)
            return {id: this.id};
        return null;
    }

    // [x, y, radius] of a subject on screen, or null.
    targetOf(subject) {
        if (!subject.tr && subject.id === this.id)
            return [this.cx, this.cy, this.RF + 4];
        const item = this.items.find(x => subject.tr ? x.tr === subject.tr : x.id === subject.id);
        return item?.on && !item.hidden && item.x !== undefined ? [item.x, item.y, item.R + 4] : null;
    }

    has(subject) {
        return !!this.targetOf(subject);
    }

    // Ids of what is here now, for the rotating fact cards.
    get present() {
        return this.items.filter(item => item.on && !item.tr && item.kind !== 'lpoint').map(item => item.id);
    }
}

const rank = item => ({moon: 0, mission: 1, sat: 2, swarm: 3, lpoint: 4, lander: 5})[item.kind] ?? 6;
