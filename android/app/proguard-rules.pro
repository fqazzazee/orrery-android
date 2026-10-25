# SPDX-License-Identifier: GPL-2.0-or-later
#
# The page calls the bridge (Page.Bridge) by name, where R8 cannot see it.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
