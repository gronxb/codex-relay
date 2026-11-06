# Nitro's JNI OnLoad finds the implementation by name
# ("Lcom/directfetch/HybridDirectFetch;") and calls its no-argument
# constructor. Nothing in Java or Kotlin references it, so R8 removes it from
# a minified app. HybridDirectFetchSpec's members are already kept by @Keep.
-keep class com.directfetch.HybridDirectFetch {
    <init>();
}
