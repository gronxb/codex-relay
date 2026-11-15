#include <jni.h>
#include <fbjni/fbjni.h>
#include "DirectFetchOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::directfetch::registerAllNatives();
  });
}
// QA only (Hot Updater rc.47 floor check): a comment that moves the native fingerprint; reverted next.
