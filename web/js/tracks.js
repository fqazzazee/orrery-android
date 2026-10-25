// Music from a folder of your own, shuffled, as the GNOME extension plays
// it (lib/music.js). On Android the app plays it with Android's media player
// (android/.../FolderMusic.kt), so any format the phone knows plays, and the
// page only says what it wants. In a browser: the files of a folder picked
// for this visit, in an <audio> element.

import * as Host from './host.js';

const AUDIO = /\.(mp3|ogg|oga|opus|flac|wav|m4a|aac)$/i;
const FADE_IN = 2.5;
const FADE_OUT = 1.2;

export class FolderMusic {
    constructor() {
        this._wanted = false;
        this._volume = 0.35;
        this._folder = '';
        // In a browser:
        this._files = [];
        this._order = [];
        this._audio = null;
        this._level = 0;
        this._fade = 0;
    }

    get playing() {
        return this._wanted;
    }

    setVolume(v) {
        this._volume = Math.max(0, Math.min(1, v));
        if (Host.onAndroid)
            this._tell();
        else
            this._fadeTo(this._wanted ? this._volume : 0, 0.3);
    }

    // folder: the setting (on Android, the folder Android gave access to).
    play(folder) {
        if (this._wanted && folder === this._folder)
            return;
        this._wanted = true;
        this._folder = folder;
        if (Host.onAndroid) {
            this._tell();
            return;
        }
        if (!this._audio?.src)
            this._next();
        this._audio?.play().catch(() => {});
        this._fadeTo(this._volume, FADE_IN);
    }

    pause() {
        if (!this._wanted)
            return;
        this._wanted = false;
        if (Host.onAndroid)
            this._tell();
        else
            this._fadeTo(0, FADE_OUT, () => this._audio?.pause());
    }

    // The browser lets sound start only after a touch: try again then.
    unlock() {
        if (this._wanted && this._audio?.paused)
            this._audio.play().catch(() => {});
    }

    // How many tracks there are, and what went wrong, for the settings.
    status() {
        if (Host.onAndroid) {
            try {
                return JSON.parse(Host.ask('musicStatus') ?? '{}');
            } catch {
                return {};
            }
        }
        return {tracks: this._files.length, error: this._files.length ? null : 'Choose the folder again: a browser forgets it'};
    }

    // In a browser: the files of the folder just picked. They last as long
    // as the page.
    useFiles(files) {
        const wasPlaying = this._wanted;
        for (const f of this._files)
            URL.revokeObjectURL(f.url);
        this._files = [...files].filter(f => AUDIO.test(f.name)).map(f => ({name: f.name, url: URL.createObjectURL(f)}));
        this._order = [];
        this._audio?.removeAttribute('src');
        if (wasPlaying) {
            this._wanted = false;
            this.play(this._folder);
        }
        return this._files.length;
    }

    // Android hears only what changed.
    _tell() {
        const state = JSON.stringify({play: this._wanted, folder: this._folder, volume: this._volume});
        if (state === this._told)
            return;
        this._told = state;
        Host.call('music', state);
    }

    // The next track, shuffled: every track once before any plays again.
    _next() {
        if (!this._files.length)
            return;
        if (!this._order.length)
            this._order = this._files.map((_, i) => [Math.random(), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
        if (!this._audio) {
            this._audio = new Audio();
            this._audio.volume = 0;
            this._audio.addEventListener('ended', () => this._next());
            this._audio.addEventListener('error', () => this._skip());
        }
        this._audio.src = this._files[this._order.pop()].url;
        if (this._wanted)
            this._audio.play().catch(() => {});
    }

    // A file that will not play: on to the next, unless none will.
    _skip() {
        this._failures = (this._failures ?? 0) + 1;
        if (this._failures < this._files.length)
            this._next();
    }

    _fadeTo(target, seconds, done = null) {
        cancelAnimationFrame(this._fade);
        const from = this._level, t0 = performance.now();
        const step = now => {
            const k = Math.min(1, (now - t0) / (seconds * 1000));
            this._level = from + (target - from) * k;
            if (this._audio)
                this._audio.volume = Math.max(0, Math.min(1, this._level));
            if (k < 1)
                this._fade = requestAnimationFrame(step);
            else
                done?.();
        };
        this._fade = requestAnimationFrame(step);
    }

    destroy() {
        this.pause();
        for (const f of this._files)
            URL.revokeObjectURL(f.url);
    }
}
