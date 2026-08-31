import { type ConfigPlugin, withAndroidManifest } from "expo/config-plugins";

const hotUpdaterPublicKeyName = "com.hotupdater.PUBLIC_KEY";

const withHotUpdaterAndroidPublicKey: ConfigPlugin = (config) =>
  withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0];
    const metadata = application?.["meta-data"];

    for (const entry of metadata ?? []) {
      if (entry.$?.["android:name"] !== hotUpdaterPublicKeyName) {
        continue;
      }

      const publicKey = entry.$["android:value"];
      if (publicKey) {
        entry.$["android:value"] = publicKey.replaceAll("\n", "\\n");
      }
    }

    return manifestConfig;
  });

export default withHotUpdaterAndroidPublicKey;
