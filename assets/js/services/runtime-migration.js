"use strict";
/** Copies the application's trees without overwriting or removing source data. */
WorkTimeApp.services.runtimeMigration = (() => {
  const chunkSize = 1024 * 1024;
  async function copy(
    source,
    target,
    { migrate, signal, progress = () => {} },
  ) {
    const result = {
      phase: "scanning",
      total: 0,
      completed: 0,
      skipped: 0,
      totalBytes: 0,
      processedBytes: 0,
      current: "",
      music: [],
    };
    const files = [],
      directories = [
        "backups",
        "backups/automatic",
        "backups/manual",
        "ebooks",
        "music",
      ];
    let lastReport = 0;
    const check = () => {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    };
    async function report(force = false) {
      check();
      if (force || Date.now() - lastReport >= 100) {
        lastReport = Date.now();
        progress({ ...result });
        await new Promise((resolve) => setTimeout(resolve, 0));
        check();
      }
    }
    const problem = (code, path) =>
      Object.assign(Error(code), { folderCode: code, path });
    async function child(directory, name) {
      check();
      try {
        return await directory.getDirectoryHandle(name);
      } catch (error) {
        if (error.name === "NotFoundError") return null;
        if (error.name !== "TypeMismatchError") throw error;
      }
      return directory.getFileHandle(name);
    }
    async function walk(directory, prefix) {
      for await (const entry of directory.values()) {
        check();
        const path = prefix + "/" + entry.name;
        result.current = path;
        if (entry.kind === "directory") {
          directories.push(path);
          await walk(entry, path);
        } else {
          const file = await entry.getFile();
          files.push({ path, handle: entry, file });
          result.total++;
          result.totalBytes += file.size;
        }
        await report();
      }
    }
    async function directoryAt(path, create = false) {
      let directory = target;
      let prefix = "";
      for (const part of path.split("/").filter(Boolean)) {
        check();
        prefix += (prefix ? "/" : "") + part;
        const entry = await child(directory, part);
        if (entry && entry.kind !== "directory")
          throw problem("migrationConflict", prefix);
        if (!entry && !create) return null;
        directory =
          entry || (await directory.getDirectoryHandle(part, { create: true }));
      }
      return directory;
    }
    async function equal(left, right) {
      if (left.size !== right.size) return false;
      for (let at = 0; at < left.size; at += chunkSize) {
        check();
        const [a, b] = await Promise.all([
          left.slice(at, at + chunkSize).arrayBuffer(),
          right.slice(at, at + chunkSize).arrayBuffer(),
        ]);
        const rightBytes = new Uint8Array(b);
        if (
          new Uint8Array(a).some((value, index) => value !== rightBytes[index])
        )
          return false;
        await report();
      }
      return true;
    }
    async function destination(item) {
      const slash = item.path.lastIndexOf("/");
      const directory = await directoryAt(item.path.slice(0, slash));
      return directory ? child(directory, item.path.slice(slash + 1)) : null;
    }
    try {
      await report(true);
      if (migrate)
        for (const name of ["backups", "ebooks", "music"]) {
          result.current = name;
          const entry = await child(source, name);
          if (entry && entry.kind !== "directory")
            throw problem("migrationConflict", name);
          if (entry) await walk(entry, name);
        }
      result.phase = "checking";
      await report(true);
      for (const path of directories) {
        result.current = path;
        await directoryAt(path);
        await report();
      }
      // Complete conflict checks before creating any destination directory/file.
      for (const item of files) {
        result.current = item.path;
        const entry = await destination(item);
        if (
          entry &&
          (entry.kind !== "file" ||
            !(await equal(item.file, await entry.getFile())))
        )
          throw problem("migrationConflict", item.path);
        await report();
      }
      result.phase = "copying";
      await report(true);
      for (const path of directories) {
        result.current = path;
        await directoryAt(path, true);
        await report();
      }
      for (const item of files) {
        result.current = item.path;
        check();
        const fresh = await item.handle.getFile();
        if (
          fresh.size !== item.file.size ||
          fresh.lastModified !== item.file.lastModified
        )
          throw problem("sourceChanged", item.path);
        const entry = await destination(item);
        let output;
        if (entry) {
          if (
            entry.kind !== "file" ||
            !(await equal(item.file, await entry.getFile()))
          )
            throw problem("migrationConflict", item.path);
          output = await entry.getFile();
          result.skipped++;
          result.processedBytes += item.file.size;
        } else {
          const slash = item.path.lastIndexOf("/");
          const directory = await directoryAt(item.path.slice(0, slash), true);
          const name = item.path.slice(slash + 1);
          const file = await directory.getFileHandle(name, { create: true });
          let writer;
          try {
            writer = await file.createWritable();
            for (let at = 0; at < item.file.size; at += chunkSize) {
              check();
              const bytes = await item.file
                .slice(at, at + chunkSize)
                .arrayBuffer();
              await writer.write(bytes);
              result.processedBytes += bytes.byteLength;
              await report(at === 0);
            }
            check();
            await writer.close();
            writer = null;
            output = await file.getFile();
          } catch (error) {
            try {
              await writer?.abort();
            } catch {}
            try {
              await directory.removeEntry(name);
            } catch (cleanup) {
              error.cleanupFailed = true;
              error.cleanupMessage = cleanup.message;
            }
            throw error;
          }
          result.completed++;
        }
        if (item.path.startsWith("music/"))
          result.music.push({
            path: item.path.slice(6),
            before: `${item.file.size}:${item.file.lastModified}`,
            after: `${output.size}:${output.lastModified}`,
          });
        await report(true);
      }
      result.current = "";
      return result;
    } catch (error) {
      error.path ||= result.current;
      error.migrationResult = { ...result };
      throw error;
    }
  }
  return { copy };
})();
