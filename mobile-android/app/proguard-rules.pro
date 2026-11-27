# Keep JavaScript interface methods
-keepclassmembers class com.anycraft.app.MainActivity$NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
