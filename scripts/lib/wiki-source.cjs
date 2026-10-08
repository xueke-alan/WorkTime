"use strict";
// Shared source contract for the two development-only daily Wikipedia generators.
const dates = Object.freeze(
  Array.from({ length: 12 }, (_, month) =>
    Array.from(
      { length: new Date(2024, month + 1, 0).getDate() },
      (_, day) => `${month + 1}月${day + 1}日`,
    ),
  ).flat(),
);
function stripReferences(text) {
  return text
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}
async function fetchPages(
  titles,
  {
    request = fetch,
    pause = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  } = {},
) {
  const url =
    "https://zh.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content%7Cids&rvslots=main&format=json&titles=" +
    encodeURIComponent(titles.join("|"));
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await request(url, {
        signal: AbortSignal.timeout(40000),
      });
      if (!response.ok) throw Error("HTTP " + response.status);
      const data = await response.json();
      if (!data.query?.pages || typeof data.query.pages !== "object")
        throw Error(
          "Missing Wikipedia pages: " + JSON.stringify(data.error || null),
        );
      return data;
    } catch (error) {
      if (attempt === 3) throw error;
      await pause(3000 * (attempt + 1));
    }
  }
}
module.exports = { dates, stripReferences, fetchPages };
