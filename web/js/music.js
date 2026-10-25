// Background music: the GNOME extension's slow ambient piece (lib/music.js),
// made up as it plays, with Web Audio in place of GStreamer: drifting pad
// chords, a low drone, a breath of wind and soft bell notes in long echoes.

const CHORD_SECONDS = 18;
const GLIDE_SECONDS = 6;
const LOOKAHEAD = 3;

// Pad chords (four voices, Hz): A sus2, F, C maj7, G sus2.
const CHORDS = [
    [110.00, 164.81, 246.94, 329.63],
    [87.31, 174.61, 220.00, 261.63],
    [130.81, 196.00, 246.94, 329.63],
    [98.00, 146.83, 220.00, 293.66],
];
// Bell notes: A minor pentatonic, which sits well over every chord.
const BELLS = [329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00];
const DETUNE = 0.35;           // Hz between the two oscillators of a pad voice

export class Music {
    constructor() {
        this._volume = 0.35;
        this._wanted = false;
        this._ctx = null;
    }

    get playing() {
        return this._wanted;
    }

    setVolume(v) {
        this._volume = Math.max(0, Math.min(1, v));
        if (this._wanted && this._master)
            this._master.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.3);
    }

    play() {
        if (this._wanted)
            return;
        this._wanted = true;
        try {
            if (!this._ctx)
                this._build();
            this._ctx.resume();
        } catch (e) {
            console.warn(`Orrery: no music: ${e.message}`);
            this._wanted = false;
            return;
        }
        const now = this._ctx.currentTime;
        this._master.gain.cancelScheduledValues(now);
        this._master.gain.setValueAtTime(this._master.gain.value, now);
        this._master.gain.linearRampToValueAtTime(this._volume, now + 2.5);
        this._timer ??= setInterval(() => this._compose(), 500);
        this._compose();
    }

    pause() {
        if (!this._wanted)
            return;
        this._wanted = false;
        const ctx = this._ctx;
        const now = ctx.currentTime;
        this._master.gain.cancelScheduledValues(now);
        this._master.gain.setValueAtTime(this._master.gain.value, now);
        this._master.gain.linearRampToValueAtTime(0, now + 1.2);
        clearInterval(this._timer);
        this._timer = null;
        setTimeout(() => {
            if (!this._wanted)
                ctx.suspend();
        }, 1300);
    }

    // The browser lets sound start only after a touch: try again then.
    unlock() {
        if (this._wanted && this._ctx?.state === 'suspended')
            this._ctx.resume();
    }

    _build() {
        const ctx = this._ctx = new AudioContext();
        this._master = ctx.createGain();
        this._master.gain.value = 0;
        // Two echoes and a gentle low-pass, as in the GStreamer version.
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 2800;
        lowpass.Q.value = 0.5;
        const mix = ctx.createGain();
        const echo = (delay, intensity, feedback, input, output) => {
            const d = ctx.createDelay(2);
            d.delayTime.value = delay;
            const fb = ctx.createGain();
            fb.gain.value = feedback;
            const wet = ctx.createGain();
            wet.gain.value = intensity;
            input.connect(d);
            d.connect(fb);
            fb.connect(d);
            d.connect(wet);
            wet.connect(output);
        };
        const stage = ctx.createGain();
        mix.connect(stage);
        echo(0.42, 0.45, 0.55, mix, stage);
        const out = ctx.createGain();
        stage.connect(out);
        echo(1.13, 0.35, 0.45, stage, out);
        out.connect(lowpass);
        lowpass.connect(this._master);
        this._master.connect(ctx.destination);

        // A voice whose loudness swells and fades on a slow sine.
        const lfoGain = (hz, offset, amplitude) => {
            const g = ctx.createGain();
            g.gain.value = offset;
            const lfo = ctx.createOscillator();
            lfo.frequency.value = hz;
            const depth = ctx.createGain();
            depth.gain.value = amplitude;
            lfo.connect(depth);
            depth.connect(g.gain);
            lfo.start();
            g.connect(mix);
            return g;
        };
        const osc = (freq, into, type = 'sine') => {
            const o = ctx.createOscillator();
            o.type = type;
            o.frequency.value = freq;
            o.connect(into);
            o.start();
            return o;
        };
        this._pads = [];
        for (let v = 0; v < 4; v++) {
            this._pads.push([0, 1].map(i => osc(CHORDS[0][v] + (i ? DETUNE : 0),
                lfoGain(0.021 + 0.013 * v + 0.004 * i, 0.055 - 0.008 * v, 0.03))));
        }
        osc(55, lfoGain(0.017, 0.07, 0.03));
        osc(82.41, lfoGain(0.011, 0.035, 0.025));

        // Wind: pink-ish noise, barely there.
        const len = ctx.sampleRate * 4;
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99765 * b0 + white * 0.0990460;
            b1 = 0.96300 * b1 + white * 0.2965164;
            b2 = 0.57000 * b2 + white * 1.0526913;
            data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;
        noise.connect(lfoGain(0.007, 0.006, 0.004));
        noise.start();

        this._bells = [0, 1, 2].map(() => {
            const g = ctx.createGain();
            g.gain.value = 0;
            g.connect(mix);
            const gh = ctx.createGain();
            gh.gain.value = 0;
            gh.connect(mix);
            return {g, gh, o: osc(440, g), oh: osc(880, gh)};
        });
        this._chord = 0;
        this._nextChord = ctx.currentTime;
        this._nextBell = ctx.currentTime + 2;
        this._bellVoice = 0;
    }

    _compose() {
        if (!this._ctx || !this._wanted)
            return;
        const now = this._ctx.currentTime;
        while (this._nextChord < now + LOOKAHEAD) {
            const t = Math.max(this._nextChord, now + 0.2);
            const chord = CHORDS[this._chord % CHORDS.length];
            this._pads.forEach((pair, v) => pair.forEach((o, i) => {
                const f = chord[v] + (i ? DETUNE : 0);
                o.frequency.setValueAtTime(o.frequency.value, t);
                o.frequency.linearRampToValueAtTime(f, t + GLIDE_SECONDS);
            }));
            this._chord++;
            this._nextChord = t + CHORD_SECONDS;
        }
        while (this._nextBell < now + LOOKAHEAD) {
            const t = Math.max(this._nextBell, now + 0.2);
            const voice = this._bells[this._bellVoice++ % 3];
            const f = BELLS[Math.floor(Math.random() * BELLS.length)] / (Math.random() < 0.25 ? 2 : 1);
            const peak = 0.05 + 0.04 * Math.random();
            voice.o.frequency.setValueAtTime(f, t);
            voice.oh.frequency.setValueAtTime(2 * f, t);
            for (const [g, k] of [[voice.g, 1], [voice.gh, 0.22]]) {
                g.gain.setValueAtTime(0, t);
                g.gain.linearRampToValueAtTime(peak * k, t + 0.03);
                g.gain.linearRampToValueAtTime(peak * k * 0.35, t + 1.2);
                g.gain.linearRampToValueAtTime(0, t + 5.5);
            }
            // Sparse and unhurried: a note every 3 to 10 seconds, now and
            // then a quick second one.
            this._nextBell = t + (Math.random() < 0.2 ? 0.6 : 3 + 7 * Math.random());
        }
    }

    destroy() {
        this._wanted = false;
        clearInterval(this._timer);
        this._ctx?.close();
        this._ctx = null;
    }
}
