"use strict";
/** Music preferences are device-local and deliberately separate from work archives. */
WorkTimeApp.services.musicStorage = (() => {
  let database;
  async function open() {
    if (!database)
      database = new Promise((resolve, reject) => {
        const request = indexedDB.open("worktime-music", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("settings");
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            database = null;
          };
          resolve(db);
        };
        request.onerror = () => {
          database = null;
          reject(request.error);
        };
        request.onblocked = () => {
          database = null;
          reject(Error("Storage blocked"));
        };
      });
    return database;
  }
  async function read(key = "player") {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("settings")
        .objectStore("settings")
        .get(key);
      request.onsuccess = () => resolve(request.result || {});
      request.onerror = () => reject(request.error);
    });
  }
  async function write(value, key = "player") {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(tx.error || Error("Storage unavailable"));
    });
  }
  return {
    read,
    write,
    readPresentation: () => read("presentation"),
    writePresentation: (value) => write(value, "presentation"),
  };
})();
