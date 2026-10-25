# Orrery for Android

A live solar system for your phone or tablet: an app, a live wallpaper for the home and lock screens, and a screensaver. Every planet sits where it really is, and the spacecraft of the space age fly the paths they really flew. It's all drawn on pure black for OLED screens.

[![Android 8+](https://img.shields.io/badge/Android-8%2B-3DDC84?logo=android&logoColor=white)](#install)
[![Latest release](https://img.shields.io/github/v/release/fqazzazee/orrery-android?include_prereleases&color=FFC46B)](https://github.com/fqazzazee/orrery-android/releases)
[![NASA JPL data](https://img.shields.io/badge/orbits-NASA%20JPL-0B3D91)](https://ssd.jpl.nasa.gov)
[![License: GPL-2.0-or-later](https://img.shields.io/badge/license-GPL--2.0--or--later-61AFEF)](LICENSE)

This is the Android fork of [Orrery for GNOME](https://github.com/fqazzazee/orrery). The astronomy, the mission paths, the fact cards and the drawing code are the same modules (`lib/`); what is new is a touch interface sized for phones and tablets, and the Android app around it.

<img alt="Orrery replaying the space age: the planets turning around the Sun, the spacecraft's trails in color, and a card popping up for each event" src="docs/media/hero.webp">

## Four ways to run it

- **The app.** Full screen, with the timeline, the cards and the settings.
- **Live wallpaper.** The solar system behind your home screen. It turns a little as you swipe between home screen pages, and a tap on an empty spot shows a card for the planet there. It replays the space age by default, without the date and the cards.
- **Lock screen.** The same live wallpaper, set for the lock screen as well. While the phone is locked it keeps to the middle of the screen, clear of the clock and the notifications, and shows the solar system right now.
- **Screensaver.** While charging or docked: the missions' stories one after another, each from launch to the end, with the dates and the cards. It dims after ten minutes.

Each one has its own settings for the clock, the speed, the cards, the brightness and the frame rate (**Settings ▸ Live wallpaper / Lock screen / Screensaver**). Everything else, like what is shown, the spin and the camera, is shared.

In the app, **Settings ▸ Use Orrery as** has a button for each. Android lets an app ask to be the wallpaper, but you pick where it goes: choose **Home and lock screen** to have it on both. The screensaver is picked in the system's **Display ▸ Screen saver** settings.

## Touch

- **Tap** anything for a card of live facts: how far away it is, how long its light and radio take to reach us, what the trip would take, and trivia about each world. Tap again to let it go.
- **Double-tap a planet** to fly in to its moons, satellites and landers. Back, or a double-tap on empty space, flies out again.
- **Pinch** out to zoom past the Voyagers to the heliopause, the Oort cloud and the nearest stars, or in to a planet.
- **Drag** to turn the solar system around the Sun, or tilt it.
- **Press and hold** to trace something's path without opening its card.
- **The timeline** shows up when you touch the screen. Drag it through sixty years of launches and flybys, and on to the missions still to come. The list button opens the panel: tours, what to show, the missions, and the settings.

## Phones and tablets

The layout follows the screen:

- **Phone, upright:** the date on top, the planets in the middle, one card at a time at the bottom, and the timeline in two rows. Distances are squeezed logarithmically so the inner planets are not a huddle around the Sun.
- **Phone, sideways:** the planets keep left of the cards, and an event card stands in for the fact card.
- **Tablet:** cards stack on the right as on the desktop, and the timeline runs along the bottom.

The status bar, the navigation bar and the camera cutout are kept clear. **Full screen** (on by default) hides the bars; swipe from an edge to bring them back.

## Power and OLED care

- **Stops when hidden:** the app, the wallpaper and the screensaver draw nothing while they are off screen.
- **Frame rates:** 30 a second in the app, 24 on the home screen, 20 on the lock screen, and 5 while nothing moves.
- **Battery saver:** in Android's battery saver, the frame rate drops further.
- **Sunlight view** can turn on by itself while charging, or off it.
- **True black** and pixel shift, as on the desktop, and an optional dim after a few idle minutes.

## Install

Download `orrery_X.Y.Z_android.apk` from the [releases](https://github.com/fqazzazee/orrery-android/releases) and open it on the phone (allow installs from your browser or file manager when Android asks). Android 8 or later; the page needs an up-to-date Android System WebView (Chrome 89 or later), which Play keeps current.

The APK is about 300 KB and asks for no permissions: the whole app is in it, and links open in your browser.

## Build

```sh
make apk-debug                    # android/app/build/outputs/apk/debug/app-debug.apk, and lint
make apk APK_VERSION=1.0.0        # dist/orrery_1.0.0_android.apk, signed with the release key
make apk-cert                     # the release certificate's SHA-256
make serve                        # the web app at http://127.0.0.1:8765/web/
```

`make apk` signs with the key named by `ORRERY_SIGNING_KEYSTORE` (a PKCS12 file), `ORRERY_SIGNING_PASSWORD` and `ORRERY_SIGNING_ALIAS`, taken from the environment or from `~/.android/orrery-release.env`. The key is never in the repository. Each release must be signed with the same key, or it will not install over the one before. To release, build with `make apk`, then attach the APK to a GitHub release tagged `vX.Y.Z`.

It needs the Android SDK in `~/Android/Sdk` (or `ANDROID_HOME`) and a JDK (Android Studio's, in `/opt/android-studio/jbr`, if there is one).

In a browser, `?surface=wallpaper`, `lock` or `dream` shows the other ways it runs.

## How it is put together

| Where | What |
| --- | --- |
| `lib/` | The astronomy, the bodies, the missions and their paths, the facts, the tours, and the Cairo drawing code: shared with the GNOME extension, unchanged. |
| `web/js/cairo.js` | The part of Cairo's API that `lib/render.js` uses, drawn on a web canvas, so the same drawing code paints in a browser. |
| `web/js/scene.js` | The solar system, the cards, the labels and the timeline, laid out for touch and for any screen size. |
| `web/js/main.js` | The frame clock, the gestures, the power saving, and the messages from Android. |
| `web/js/store.js` | The settings, with each surface's own values over the shared ones. |
| `android/` | The app: a WebView that serves `web/` and `lib/` from the APK's assets, the live wallpaper (the page on a virtual display that draws into the wallpaper's surface), the screensaver, and the bridge that keeps one set of settings for all three. |

## What is not here yet

- **Your own music.** The ambient music is here; playing a folder of your own tracks is not.
- **Desktop-only features** (see-through apps, several monitors, the desktop's right-click menu) have no Android counterpart.

## How the paths are built

**Lambert legs.** Each leg between two encounters is the orbit that joins the two bodies' real positions on those dates (Lambert's problem). The path is exact at every encounter.

**Waypoints.** Some craft fired their engines between encounters: the ion-driven Dawn, Psyche and BepiColombo, or long loops like Ulysses's. For them, waypoints from NASA JPL's Horizons trajectories keep the path to the one the craft really flew.

**Resonant loops.** Some legs leave a planet and return to it after a whole number of its years, like Parker's Venus loops and Galileo's two-year loop. These use the craft's known number of laps and its perihelion.

**Leaving the planets.** The Pioneers and Voyagers head out in their real directions at their real speeds.

## Contributing

Bug reports and ideas are welcome in [issues](https://github.com/fqazzazee/orrery-android/issues). Say which phone or tablet and which Android version, and whether it is the app, the wallpaper, the lock screen or the screensaver.

A change to the astronomy, the missions or the cards belongs in [Orrery for GNOME](https://github.com/fqazzazee/orrery), where `lib/` comes from.

## License

Orrery is free software under the GPL-2.0-or-later ([`LICENSE`](LICENSE)). The Outfit font in `web/fonts/` is under the SIL Open Font License ([`web/fonts/OFL.txt`](web/fonts/OFL.txt)).

The planets' orbits come from NASA JPL's approximate orbital elements. The asteroid and comet orbits come from JPL's Small-Body Database. The spacecraft paths are checked against JPL Horizons.
