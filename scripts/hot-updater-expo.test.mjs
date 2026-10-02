import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appDirectory = fileURLToPath(new URL("../apps/mobile/", import.meta.url));
const publicKey = readFileSync(
  new URL("../apps/mobile/keys/public-key.pem", import.meta.url),
  "utf8",
);

for (const format of ["module", "commonjs"]) {
  test(`Hot Updater reads the Expo OTA signing key through its ${format} entry`, () => {
    const load =
      format === "module"
        ? 'import { getExpoBundleSigningPublicKey } from "@hot-updater/expo";'
        : 'const { getExpoBundleSigningPublicKey } = require("@hot-updater/expo");';
    // A real Node process exercises package exports; a test bundler can hide
    // the Expo 58 resolution failure that otherwise blocks OTA deployment.
    const output = execFileSync(
      process.execPath,
      [
        `--input-type=${format}`,
        "--eval",
        `${load}\ngetExpoBundleSigningPublicKey(process.cwd()).then(value => console.log(JSON.stringify(value)));`,
      ],
      { cwd: appDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

    assert.equal(JSON.parse(output).publicKey.trim(), publicKey.trim());
  });
}
