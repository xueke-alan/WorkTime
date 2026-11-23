"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
async function main() {
  const credential = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const token = credential
    .split(/\r?\n/)
    .find((line) => line.startsWith("password="))
    ?.slice(9);
  if (!token) throw Error("GitHub credential unavailable");
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "User-Agent": "WorkTime-model-release",
  };
  const api = "https://api.github.com/repos/xueke-alan/WorkTime/releases";
  const tag = "speech-models-v1";
  let response = await fetch(api + "/tags/" + tag, { headers });
  if (response.status === 404)
    response = await fetch(api, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: "368bfd6cdd9ca2c12c1330c01be1269712ac6c9d",
        name: "Speech models v1",
        body: "Pinned Supertonic 3 F1 and Piper Jenny Dioco model resources. Original model licenses and attribution are included in the offline package. Model bytes retain their upstream SHA-256 checksums.",
        draft: false,
        prerelease: false,
      }),
    });
  if (!response.ok) throw Error("Release API status " + response.status);
  const release = await response.json();
  const manifest = require("../../assets/vendor/vocabulary/manifest.json");
  for (const [engine, names] of Object.entries(manifest.groups))
    for (const name of names) {
      const assetName = engine + "-" + name.replaceAll("/", "-");
      const spec = manifest.files[name];
      const revision =
        engine === "piper"
          ? "e9c8a39444359388adaa94255becb37a5a2b8e51"
          : "aafc6e32416a594460b32413efc49d7fe4ce6d46";
      const file = path.resolve(
        __dirname,
        "../../.cache/speech-comparison",
        revision + "-" + name.replaceAll("/", "-"),
      );
      const bytes = fs.readFileSync(file);
      if (
        bytes.length !== spec.bytes ||
        require("node:crypto")
          .createHash("sha256")
          .update(bytes)
          .digest("hex") !== spec.sha256
      )
        throw Error("Invalid local model");
      const upload = async (name, payload) => {
        if (release.assets?.some((asset) => asset.name === name)) return;
        const uploaded = await fetch(
          release.upload_url.replace(/\{.*$/, "") +
            "?name=" +
            encodeURIComponent(name),
          {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/octet-stream" },
            body: payload,
          },
        );
        if (!uploaded.ok)
          throw Error("Upload " + name + " status " + uploaded.status);
        console.log("Uploaded " + name);
      };
      await upload(assetName, bytes);
      const parts = Array.from(
        { length: Math.ceil(bytes.length / (3 * 1024 ** 2)) },
        (_, i) => i,
      );
      for (let offset = 0; offset < parts.length; offset += 4)
        await Promise.all(
          parts
            .slice(offset, offset + 4)
            .map((i) =>
              upload(
                assetName + ".part-" + i + ".js",
                Buffer.from(
                  "WorkTimeApp.data.vocabularyModelChunk=" +
                    JSON.stringify(
                      bytes
                        .subarray(i * 3 * 1024 ** 2, (i + 1) * 3 * 1024 ** 2)
                        .toString("base64"),
                    ) +
                    ";\n",
                ),
              ),
            ),
        );
    }
  const packageName = "worktime-speech-models-v1.wtmodels";
  if (!release.assets?.some((asset) => asset.name === packageName)) {
    const packagePath = path.resolve(
      __dirname,
      "../../.cache/speech-packages",
      packageName,
    );
    const uploaded = await fetch(
      release.upload_url.replace(/\{.*$/, "") + "?name=" + packageName,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/octet-stream" },
        body: fs.readFileSync(packagePath),
      },
    );
    if (!uploaded.ok)
      throw Error("Offline package upload status " + uploaded.status);
    console.log("Uploaded " + packageName);
  }
  console.log(release.html_url);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
