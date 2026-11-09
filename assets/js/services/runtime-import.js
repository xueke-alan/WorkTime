"use strict";
/** Copies only into an already-authorized media directory. Never writes to sources. */
WorkTimeApp.services.runtimeImport = (() => {
  const chunkSize = 1024 * 1024;
  const audio = /\.(mp3|m4a|mp4|aac|flac|wav|wave|ogg|oga|opus|webm)$/i;
  const companion = /\.(lrc|txt|jpg|jpeg|png|webp)$/i;
  const books = /\.(epub|pdf|txt)$/i;
  const check = (signal) => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  function pathFor(file) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split("/");
    if (
      parts.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[<>:"\\|?*\u0000-\u001f]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
    )
      throw Error("Invalid relative path: " + path);
    return path;
  }
  async function equal(source, destination, signal) {
    if (source.size !== destination.size) return false;
    for (let at = 0; at < source.size; at += chunkSize) {
      check(signal);
      const [a, b] = await Promise.all([
        source.slice(at, at + chunkSize).arrayBuffer(),
        destination.slice(at, at + chunkSize).arrayBuffer(),
      ]);
      const left = new Uint8Array(a),
        right = new Uint8Array(b);
      if (left.some((byte, index) => byte !== right[index])) return false;
    }
    return true;
  }
  async function existing(directory, name) {
    try {
      return await directory.getFileHandle(name);
    } catch (error) {
      if (error.name === "NotFoundError") return null;
      if (error.name === "TypeMismatchError") return { kind: "directory" };
      throw error;
    }
  }
  async function copy(root, kind, files, { signal, progress = () => {} } = {}) {
    const result = {
      completed: 0,
      skipped: 0,
      unsupported: 0,
      failed: 0,
      cancelled: false,
      bytes: 0,
      processedBytes: 0,
      totalBytes: 0,
      total: files.length,
      current: "",
      errors: [],
      imported: [],
    };
    let lastReport = 0;
    function report(force = false) {
      if (force || Date.now() - lastReport >= 100) {
        lastReport = Date.now();
        progress({ ...result, errors: [...result.errors] });
      }
    }
    const groups = new Map();
    let validated = 0;
    for (const file of files) {
      if (signal?.aborted) {
        result.cancelled = true;
        report(true);
        return result;
      }
      if (++validated % 200 === 0) {
        report();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      try {
        const path = pathFor(file);
        if (
          !(kind === "ebooks"
            ? books.test(path)
            : audio.test(path) || companion.test(path))
        ) {
          result.unsupported++;
          continue;
        }
        const slash = path.lastIndexOf("/"),
          dot = path.lastIndexOf(".");
        const folder = path.slice(0, slash + 1),
          stem = path.slice(slash + 1, dot),
          extension = path.slice(dot);
        const key =
          kind === "music" ? (folder + stem).toLowerCase() : path.toLowerCase();
        let group = groups.get(key);
        if (
          !group ||
          group.files.some(
            (item) => item.extension.toLowerCase() === extension.toLowerCase(),
          )
        ) {
          group = { folder, stem, files: [] };
          groups.set(key + (groups.has(key) ? "#" + groups.size : ""), group);
        }
        group.files.push({ file, path, extension });
      } catch (error) {
        result.failed++;
        result.errors.push({ path: file.name, message: error.message });
      }
    }
    result.totalBytes = [...groups.values()].reduce(
      (sum, group) =>
        sum + group.files.reduce((size, item) => size + item.file.size, 0),
      0,
    );
    report(true);
    for (const group of groups.values()) {
      const created = [];
      const processedStart = result.processedBytes;
      try {
        check(signal);
        let directory = root;
        for (const segment of group.folder.split("/").filter(Boolean)) {
          check(signal);
          directory = await directory.getDirectoryHandle(segment, {
            create: true,
          });
        }
        let plans;
        for (let suffix = 1; ; suffix++) {
          check(signal);
          const stem = group.stem + (suffix === 1 ? "" : ` (${suffix})`);
          plans = [];
          let conflict = false;
          for (const item of group.files) {
            const name = stem + item.extension;
            const target = await existing(directory, name);
            const same =
              target?.kind === "file" &&
              (await equal(item.file, await target.getFile(), signal));
            if (target && !same) {
              conflict = true;
              break;
            }
            plans.push({ ...item, name, same });
          }
          if (!conflict) break;
        }
        for (const item of plans) {
          if (item.same) {
            result.processedBytes += item.file.size;
            continue;
          }
          check(signal);
          result.current = group.folder + item.name;
          const target = await directory.getFileHandle(item.name, {
            create: true,
          });
          created.push({ directory, name: item.name });
          let writer;
          try {
            writer = await target.createWritable();
            for (let at = 0; at < item.file.size; at += chunkSize) {
              check(signal);
              const bytes = await item.file
                .slice(at, at + chunkSize)
                .arrayBuffer();
              await writer.write(bytes);
              result.bytes += bytes.byteLength;
              result.processedBytes += bytes.byteLength;
              report(result.bytes === bytes.byteLength);
            }
            check(signal);
            await writer.close();
          } catch (error) {
            try {
              await writer?.abort();
            } catch {
              /* Cleanup below also removes the incomplete file. */
            }
            throw error;
          }
        }
        result.completed += plans.filter((item) => !item.same).length;
        result.skipped += plans.filter((item) => item.same).length;
        for (const item of plans)
          result.imported.push({
            source: item.path,
            target: group.folder + item.name,
            fingerprint: `${item.file.size}:${item.file.lastModified}`,
          });
      } catch (error) {
        for (const item of created.reverse()) {
          try {
            await item.directory.removeEntry(item.name);
          } catch (cleanup) {
            result.errors.push({
              path: group.folder + item.name,
              message: cleanup.message,
            });
          }
        }
        if (error.name === "AbortError") {
          result.cancelled = true;
          break;
        }
        result.failed += group.files.length;
        result.processedBytes =
          processedStart +
          group.files.reduce((sum, item) => sum + item.file.size, 0);
        result.errors.push({
          path: group.folder + group.stem,
          message: error.message,
        });
        if (error.name === "NotAllowedError") break;
      }
      report();
    }
    report(true);
    return result;
  }
  return { copy };
})();
