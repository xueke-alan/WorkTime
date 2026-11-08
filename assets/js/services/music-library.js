"use strict";
/** Local-only directory index and bounded metadata readers. Never writes to source files. */
WorkTimeApp.services.musicLibrary = (() => {
  const audioPattern = /\.(mp3|m4a|mp4|aac|flac|wav|wave|ogg|oga|opus|webm)$/i;
  const decoder = new TextDecoder();
  const text = (bytes) => decoder.decode(bytes).replace(/\0/g, "").trim();
  const ascii = (bytes) => String.fromCharCode(...bytes);
  const uint = (b, p) =>
    new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(p);
  const sync = (b, p) =>
    ((b[p] & 127) << 21) |
    ((b[p + 1] & 127) << 14) |
    ((b[p + 2] & 127) << 7) |
    (b[p + 3] & 127);
  const read = async (file, start, size) =>
    new Uint8Array(await file.slice(start, start + size).arrayBuffer());
  const limit = 8 * 1024 * 1024;
  function tagText(b) {
    if (!b.length) return "";
    const encoding =
      ["windows-1252", "utf-16", "utf-16be", "utf-8"][b[0]] || "utf-8";
    return new TextDecoder(encoding)
      .decode(b.subarray(1))
      .replace(/\0/g, "")
      .trim();
  }
  function terminator(b, start, wide) {
    for (let p = start; p < b.length; p += wide ? 2 : 1)
      if (!b[p] && (!wide || !b[p + 1])) return p + (wide ? 2 : 1);
    return b.length;
  }
  function picture(b, old = false) {
    const wide = b[0] === 1 || b[0] === 2;
    const mimeEnd = old ? 4 : terminator(b, 1, false);
    const mime = old
      ? ascii(b.subarray(1, 4)) === "PNG"
        ? "image/png"
        : "image/jpeg"
      : text(b.subarray(1, mimeEnd - 1));
    const start = terminator(b, mimeEnd + 1, wide);
    return /^(image\/(jpeg|png|webp))$/i.test(mime)
      ? new Blob([b.subarray(start)], { type: mime })
      : null;
  }
  function id3(b, result) {
    if (ascii(b.subarray(0, 3)) !== "ID3" || ![2, 3, 4].includes(b[3])) return;
    const version = b[3],
      end = Math.min(b.length, 10 + sync(b, 6));
    let p = 10;
    if (b[5] & 64) p += version === 4 ? sync(b, p) : 4 + uint(b, p);
    while (p + (version === 2 ? 6 : 10) <= end) {
      const name = ascii(b.subarray(p, p + (version === 2 ? 3 : 4)));
      const size =
        version === 2
          ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]
          : version === 4
            ? sync(b, p + 4)
            : uint(b, p + 4);
      if (!size || !/^[A-Z0-9]+$/.test(name)) break;
      const header = version === 2 ? 6 : 10;
      if (p + header + size > end) break;
      const flags = version === 2 ? 0 : b[p + 9];
      let body = b.subarray(p + header, p + header + size);
      p += header + size;
      if ((version === 3 && flags & 192) || (version === 4 && flags & 12))
        continue;
      if (b[5] & 128 || (version === 4 && flags & 2))
        body = body.filter(
          (v, i, all) => !(v === 0 && i > 0 && all[i - 1] === 255),
        );
      const key = {
        TIT2: "title",
        TT2: "title",
        TPE1: "artist",
        TP1: "artist",
        TALB: "album",
        TAL: "album",
      }[name];
      if (key) result[key] = tagText(body);
      if (name === "APIC" || name === "PIC")
        result.cover = picture(body, name === "PIC") || result.cover;
      if (name === "USLT" || name === "ULT") {
        const start = terminator(body, 4, body[0] === 1 || body[0] === 2);
        const payload = new Uint8Array(1 + body.length - start);
        payload[0] = body[0];
        payload.set(body.subarray(start), 1);
        result.lyrics = tagText(payload);
      }
    }
  }
  function vorbis(b, result) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = 0;
    const next = () => {
      if (p + 4 > b.length) throw Error("Invalid comment");
      const length = view.getUint32(p, true);
      p += 4;
      if (length > b.length - p) throw Error("Invalid comment length");
      const value = text(b.subarray(p, p + length));
      p += length;
      return value;
    };
    next();
    if (p + 4 > b.length) return;
    const count = view.getUint32(p, true);
    p += 4;
    for (let i = 0; i < count && p < b.length; i++) {
      const value = next(),
        split = value.indexOf("=");
      const key = {
        TITLE: "title",
        ARTIST: "artist",
        ALBUM: "album",
        LYRICS: "lyrics",
        UNSYNCEDLYRICS: "lyrics",
      }[value.slice(0, split).toUpperCase()];
      if (key) result[key] = value.slice(split + 1);
      if (value.slice(0, split).toUpperCase() === "METADATA_BLOCK_PICTURE") {
        try {
          result.cover =
            flacPicture(
              Uint8Array.from(atob(value.slice(split + 1)), (character) =>
                character.charCodeAt(0),
              ),
            ) || result.cover;
        } catch {
          /* Optional picture. */
        }
      }
    }
  }
  function flacPicture(b) {
    let p = 4;
    const mimeSize = uint(b, p);
    p += 4;
    const mime = text(b.subarray(p, p + mimeSize));
    p += mimeSize;
    p += 4 + uint(b, p);
    p += 16;
    const size = uint(b, p);
    p += 4;
    return /^image\/(png|jpeg|webp)$/.test(mime) && p + size <= b.length
      ? new Blob([b.subarray(p, p + size)], { type: mime })
      : null;
  }
  function mp4Tags(b, result, depth = 0) {
    if (depth > 8) return;
    for (let p = 0; p + 8 <= b.length;) {
      const size = uint(b, p),
        type = ascii(b.subarray(p + 4, p + 8));
      if (size < 8 || size > b.length - p) break;
      const body = b.subarray(p + 8, p + size);
      if (["moov", "udta", "ilst", "meta"].includes(type))
        mp4Tags(body.subarray(type === "meta" ? 4 : 0), result, depth + 1);
      const key = {
        "©nam": "title",
        "©ART": "artist",
        aART: "artist",
        "©alb": "album",
        "©lyr": "lyrics",
        covr: "cover",
      }[type];
      if (key && body.length >= 16 && ascii(body.subarray(4, 8)) === "data") {
        const kind = uint(body, 8) & 0xffffff,
          value = body.subarray(16);
        if (key === "cover" && [13, 14].includes(kind))
          result.cover = new Blob([value], {
            type: kind === 14 ? "image/png" : "image/jpeg",
          });
        else if (key !== "cover") result[key] = text(value);
      }
      p += size;
    }
  }
  async function metadata(file) {
    const result = {};
    try {
      let b = await read(file, 0, Math.min(65536, file.size));
      if (ascii(b.subarray(0, 3)) === "ID3")
        b = await read(file, 0, Math.min(limit, 10 + sync(b, 6)));
      else if (["fLaC", "OggS"].includes(ascii(b.subarray(0, 4))))
        b = await read(file, 0, Math.min(limit, file.size));
      id3(b, result);
      if (
        ascii(b.subarray(0, 4)) === "RIFF" &&
        ascii(b.subarray(8, 12)) === "WAVE"
      ) {
        for (let p = 12; p + 8 <= file.size;) {
          const header = await read(file, p, 8),
            kind = ascii(header.subarray(0, 4));
          const size = new DataView(
            header.buffer,
            header.byteOffset,
            header.byteLength,
          ).getUint32(4, true);
          if (size > file.size - p - 8) break;
          if (["ID3 ", "id3 "].includes(kind) && size <= limit)
            id3(await read(file, p + 8, size), result);
          if (kind === "LIST" && size <= limit) {
            const info = await read(file, p + 8, size);
            if (ascii(info.subarray(0, 4)) === "INFO")
              for (let q = 4; q + 8 <= info.length;) {
                const length = new DataView(
                  info.buffer,
                  info.byteOffset,
                  info.byteLength,
                ).getUint32(q + 4, true);
                if (length > info.length - q - 8) break;
                const key = { INAM: "title", IART: "artist", IPRD: "album" }[
                  ascii(info.subarray(q, q + 4))
                ];
                if (key)
                  result[key] = text(info.subarray(q + 8, q + 8 + length));
                q += 8 + length + (length % 2);
              }
          }
          p += 8 + size + (size % 2);
        }
      }
      if (ascii(b.subarray(0, 4)) === "fLaC") {
        for (let p = 4; p + 4 <= b.length;) {
          const kind = b[p] & 127,
            last = b[p] & 128;
          const size = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
          p += 4;
          if (p + size > b.length) break;
          if (kind === 4) vorbis(b.subarray(p, p + size), result);
          if (kind === 6) result.cover = flacPicture(b.subarray(p, p + size));
          p += size;
          if (last) break;
        }
      }
      // Reassemble Ogg packets before interpreting comments (pages can split tags).
      if (ascii(b.subarray(0, 4)) === "OggS") {
        let packet = [];
        for (
          let p = 0;
          p + 27 <= b.length && ascii(b.subarray(p, p + 4)) === "OggS";
        ) {
          const segments = b[p + 26];
          let offset = p + 27 + segments;
          if (offset > b.length) break;
          for (let i = 0; i < segments; i++) {
            const length = b[p + 27 + i];
            if (offset + length > b.length) break;
            packet.push(b.subarray(offset, offset + length));
            offset += length;
            if (length < 255) {
              const data = new Uint8Array(
                packet.reduce((sum, part) => sum + part.length, 0),
              );
              let cursor = 0;
              for (const part of packet) {
                data.set(part, cursor);
                cursor += part.length;
              }
              if (ascii(data.subarray(0, 8)) === "OpusTags")
                vorbis(data.subarray(8), result);
              if (data[0] === 3 && ascii(data.subarray(1, 7)) === "vorbis")
                vorbis(data.subarray(7), result);
              packet = [];
            }
          }
          p = offset;
        }
      }
      if (/\.(m4a|mp4)$/i.test(file.name)) {
        for (let p = 0; p + 8 <= file.size;) {
          const header = await read(file, p, 16);
          let size = uint(header, 0),
            headerSize = 8;
          if (size === 1) {
            size = uint(header, 8) * 4294967296 + uint(header, 12);
            headerSize = 16;
          }
          if (!size) size = file.size - p;
          if (size < headerSize || size > file.size - p) break;
          if (ascii(header.subarray(4, 8)) === "moov" && size <= limit)
            mp4Tags(
              await read(file, p + headerSize, size - headerSize),
              result,
            );
          p += size;
        }
      }
      if (!result.title && /\.mp3$/i.test(file.name) && file.size >= 128) {
        const tail = await read(file, file.size - 128, 128);
        if (ascii(tail.subarray(0, 3)) === "TAG") {
          const decode = (start, end) =>
            new TextDecoder("windows-1252")
              .decode(tail.subarray(start, end))
              .replace(/\0/g, "")
              .trim();
          result.title = decode(3, 33);
          result.artist ||= decode(33, 63);
          result.album ||= decode(63, 93);
        }
      }
    } catch {
      /* Broken optional tags never prevent decoding the audio. */
    }
    return result;
  }
  function decodeLyrics(buffer) {
    const b = new Uint8Array(buffer);
    if (b[0] === 255 && b[1] === 254)
      return new TextDecoder("utf-16le").decode(b);
    if (b[0] === 254 && b[1] === 255)
      return new TextDecoder("utf-16be").decode(b);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      return new TextDecoder("gb18030").decode(b);
    }
  }
  function lyrics(source) {
    const lines = [],
      offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
    for (const line of source.split(/\r?\n/)) {
      const content = line.replace(/\[[^\]]*\]/g, "").trim();
      for (const match of line.matchAll(/\[(\d+):(\d{1,2}(?:\.\d+)?)\]/g))
        lines.push({
          time: Math.max(0, Number(match[1]) * 60 + Number(match[2]) + offset),
          text: content,
        });
    }
    return { lines: lines.sort((a, b) => a.time - b.time), text: source };
  }
  function entry(path, file, handle) {
    return {
      path,
      file,
      handle,
      name: path.split("/").pop(),
      getFile: () => (handle ? handle.getFile() : Promise.resolve(file)),
    };
  }
  async function scan(
    handle,
    files,
    { cancelled = () => false, progress = () => {} } = {},
  ) {
    const entries = [];
    let count = 0;
    const add = async (value) => {
      if (cancelled()) throw new DOMException("Cancelled", "AbortError");
      entries.push(value);
      if (++count % 100 === 0) {
        progress(count);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    async function walk(dir, prefix = "") {
      for await (const child of dir.values()) {
        if (cancelled()) throw new DOMException("Cancelled", "AbortError");
        const path = prefix + child.name;
        if (child.kind === "directory") await walk(child, path + "/");
        else await add(entry(path, null, child));
      }
    }
    if (handle) await walk(handle);
    else
      for (const file of files) {
        const path = file.webkitRelativePath || file.name;
        await add(
          entry(
            file.webkitRelativePath ? path.slice(path.indexOf("/") + 1) : path,
            file,
          ),
        );
      }
    const index = new Map(
      entries.map((item) => [item.path.toLowerCase(), item]),
    );
    const tracks = [];
    for (const item of entries.filter((value) =>
      audioPattern.test(value.path),
    )) {
      if (cancelled()) throw new DOMException("Cancelled", "AbortError");
      try {
        const file = await item.getFile();
        tracks.push({
          path: item.path,
          fingerprint: `${file.size}:${file.lastModified}`,
          title: item.name.replace(/\.[^.]+$/, ""),
          artist: "",
          album: "",
          ...item,
          size: file.size,
          modified: file.lastModified,
        });
      } catch (error) {
        if (error.name === "NotAllowedError" || error.name === "SecurityError")
          throw error;
        /* Files removed during a scan are omitted. */
      }
      if (tracks.length % 100 === 0) {
        progress(count);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    tracks.sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { numeric: true }),
    );
    return { tracks, index };
  }
  async function details(track, index) {
    const file = await track.getFile(),
      tags = await metadata(file);
    const stem = track.path.replace(/\.[^.]+$/, "").toLowerCase(),
      folder = stem.slice(0, stem.lastIndexOf("/") + 1);
    const get = async (path) => {
      try {
        return await index.get(path)?.getFile();
      } catch {
        return null;
      }
    };
    const lrc = await get(stem + ".lrc"),
      txt = await get(stem + ".txt");
    const lyricFile = lrc || (!tags.lyrics && txt);
    const source =
      lyricFile && lyricFile.size <= 2 * 1024 * 1024
        ? decodeLyrics(await lyricFile.arrayBuffer())
        : tags.lyrics || "";
    let cover = null;
    for (const base of [stem, folder + "cover", folder + "folder"]) {
      for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
        const candidate = await get(base + ext);
        if (candidate && candidate.size <= limit) {
          cover = candidate;
          break;
        }
      }
      if (cover) break;
    }
    return {
      title: tags.title || track.title,
      artist: tags.artist || "",
      album: tags.album || "",
      cover: tags.cover || cover,
      lyrics: lyrics(source),
    };
  }
  return { scan, details, metadata, lyrics, decodeLyrics };
})();
