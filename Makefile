UUID := orrery@fqazzazee.github.io
EXTENSIONS_DIR := $(HOME)/.local/share/gnome-shell/extensions
DEST := $(EXTENSIONS_DIR)/$(UUID)

.PHONY: pack install link test test-shell dist clean serve apk-debug apk apk-cert

# Zip for sharing or uploading to extensions.gnome.org
pack:
	gnome-extensions pack --force --extra-source=lib --schema=schemas/org.gnome.shell.extensions.orrery.gschema.xml .

# Copies the files and compiles the settings schema
install:
	rm -rf $(DEST)
	mkdir -p $(DEST)/schemas
	cp -r metadata.json extension.js prefs.js stylesheet.css lib $(DEST)/
	cp schemas/*.gschema.xml $(DEST)/schemas/
	glib-compile-schemas $(DEST)/schemas
	@echo "Log out and back in, then: gnome-extensions enable $(UUID)"

# Development: run the extension straight from this checkout
link:
	glib-compile-schemas schemas
	mkdir -p $(EXTENSIONS_DIR)
	ln -sfn $(CURDIR) $(DEST)
	@echo "Log out and back in, then: gnome-extensions enable $(UUID)"

test:
	glib-compile-schemas schemas
	gjs -m tests/unit.js

# Orrery in a real GNOME Shell of another version, in a container:
#   make test-shell DISTRO=fedora RELEASE=45     (GNOME 51; 44 is 50, 43 is 49)
#   make test-shell DISTRO=debian RELEASE=trixie (GNOME 48)
DISTRO ?= fedora
RELEASE ?= 45
test-shell:
	tests/shell/run.sh $(DISTRO) $(RELEASE)

# Release artifacts in dist/: the zip, rpm, deb and Arch packages, for the
# extension and for orrery-wallpaper (other desktops)
dist:
	packaging/build.sh

# ---- Android ----

# The web app in a browser, as on a phone: http://127.0.0.1:8765/web/
# (?surface=wallpaper, lock or dream for the other ways it runs).
serve:
	python3 -m http.server 8765 --bind 127.0.0.1

ANDROID_HOME ?= $(HOME)/Android/Sdk
# Android Studio's JDK, where there is one; otherwise the system's.
JAVA_HOME    ?= $(wildcard /opt/android-studio/jbr)
GRADLE        = cd android && ANDROID_HOME=$(ANDROID_HOME) $(if $(JAVA_HOME),JAVA_HOME=$(JAVA_HOME)) ./gradlew --no-daemon
APK_VERSION  ?= 1.0.0
APK          := dist/orrery_$(APK_VERSION)_android.apk
APKSIGNER     = $(lastword $(sort $(wildcard $(ANDROID_HOME)/build-tools/*/apksigner)))

# A debug build, for adb install.
apk-debug:
	$(GRADLE) assembleDebug lintDebug
	@echo android/app/build/outputs/apk/debug/app-debug.apk

# The release APK, signed with the release key: ORRERY_SIGNING_KEYSTORE (a
# PKCS12 file), ORRERY_SIGNING_PASSWORD and ORRERY_SIGNING_ALIAS, from the
# environment or from the file ORRERY_SIGNING_ENV names.
ORRERY_SIGNING_ENV ?= $(HOME)/.android/orrery-release.env
apk:
	@set -a; [ -f "$(ORRERY_SIGNING_ENV)" ] && . "$(ORRERY_SIGNING_ENV)"; set +a; \
	test -n "$$ORRERY_SIGNING_KEYSTORE" || { echo "apk: no release key (ORRERY_SIGNING_KEYSTORE, or $(ORRERY_SIGNING_ENV))"; exit 1; }; \
	$(GRADLE) lintRelease assembleRelease -PorreryVersion=$(APK_VERSION)
	mkdir -p dist
	cp android/app/build/outputs/apk/release/app-release.apk $(APK)
	$(APKSIGNER) verify $(APK)
	@echo $(APK)

# The release key's certificate, for the release notes.
apk-cert:
	$(APKSIGNER) verify --print-certs $(APK) | grep SHA-256

clean:
	rm -rf $(UUID).shell-extension.zip schemas/gschemas.compiled dist android/app/build android/build
