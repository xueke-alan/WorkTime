"use strict";
/** One audio element owns playback; opening/closing the dialog never recreates it. */
WorkTimeApp.ui.createMusicController = function () {
  const library = WorkTimeApp.services.musicLibrary;
  const storage = WorkTimeApp.services.musicStorage;
  const audio = new Audio();
  audio.preload = "metadata";
  const listeners = new Set(),
    failed = new Set();
  let tracks = [],
    index = new Map(),
    handle = null,
    inputFiles = [],
    directory = "";
  let current = null,
    details = null,
    favorites = new Set(),
    mode = "list";
  let history = [],
    historyAt = -1,
    bag = [];
  let scanning = 0,
    loading = 0,
    busy = false,
    readingTags = false,
    count = 0,
    status = "chooseHint",
    storageIssue = false;
  let audioURL = null,
    coverURL = null,
    sleep = "off",
    deadline = 0,
    sleepTimer;
  let pendingPosition = 0,
    saving,
    saveQueue = Promise.resolve(),
    disposed = false;
  let lastSavedSecond = -1,
    lastPublishedSecond = -1;
  const id = (track) => `${track.path}|${track.fingerprint}`;
  const emit = () => {
    if (!disposed) for (const listener of listeners) listener();
  };
  const currentIndex = () => tracks.indexOf(current);
  function snapshot() {
    return {
      tracks,
      current,
      details,
      coverURL,
      directory,
      mode,
      busy,
      readingTags,
      count,
      status,
      storageIssue,
      sleep,
      deadline,
      handle: Boolean(handle),
      needsAccess: tracks.some((track) => !track.getFile),
      paused: audio.paused,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      position: pendingPosition || audio.currentTime || 0,
      volume: audio.volume,
      muted: audio.muted,
      rate: audio.playbackRate,
      favorites,
    };
  }
  function serialized() {
    return {
      handle,
      directory,
      tracks: tracks.map(
        ({
          path,
          fingerprint,
          title,
          artist,
          album,
          name,
          size,
          modified,
        }) => ({
          path,
          fingerprint,
          title,
          artist,
          album,
          name,
          size,
          modified,
        }),
      ),
      current: current ? id(current) : null,
      position: pendingPosition || audio.currentTime || 0,
      favorites: [...favorites],
      mode,
      volume: audio.volume,
      muted: audio.muted,
      rate: audio.playbackRate,
    };
  }
  function persist(immediate = false) {
    clearTimeout(saving);
    const write = () => {
      if (disposed) return;
      const value = serialized();
      saveQueue = saveQueue
        .catch(() => {})
        .then(() => storage.write(value))
        .catch(() => {
          if (!storageIssue) {
            storageIssue = true;
            emit();
          }
        });
    };
    if (immediate) write();
    else saving = setTimeout(write, 400);
  }
  function media() {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = audio.paused
        ? "paused"
        : "playing";
      if (current && "MediaMetadata" in window)
        navigator.mediaSession.metadata = new MediaMetadata({
          title: current.title,
          artist: current.artist,
          album: current.album,
          artwork: coverURL ? [{ src: coverURL }] : [],
        });
      else if (!current) navigator.mediaSession.metadata = null;
      if (Number.isFinite(audio.duration) && audio.duration > 0)
        navigator.mediaSession.setPositionState?.({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.min(audio.currentTime, audio.duration),
        });
    } catch {
      /* Media Session actions vary by browser. */
    }
  }
  function release() {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (audioURL) URL.revokeObjectURL(audioURL);
    if (coverURL) URL.revokeObjectURL(coverURL);
    audioURL = coverURL = null;
    details = null;
  }
  function resetShuffle() {
    bag = tracks.filter((track) => track !== current).map(id);
  }
  function record(track) {
    if (history[historyAt] === id(track)) return;
    history = history.slice(0, historyAt + 1);
    history.push(id(track));
    if (history.length > 1000) history.shift();
    historyAt = history.length - 1;
  }
  async function play() {
    const token = loading;
    if (!current || !current.getFile) {
      status = current ? "accessHint" : "chooseHint";
      emit();
      return;
    }
    if (!audioURL) return select(current, true, pendingPosition);
    try {
      await audio.play();
      if (token !== loading || disposed) return;
      status = "";
    } catch (error) {
      if (token !== loading || disposed) return;
      if (error.name === "NotAllowedError") status = "playHint";
      else if (error.name !== "AbortError") return failCurrent();
    }
    emit();
  }
  function failCurrent(access = false) {
    if (!current || failed.has(id(current))) return;
    current.error = access ? "fileUnavailable" : "unsupported";
    failed.add(id(current));
    status = access ? "accessHint" : "skipError";
    audio.pause();
    emit();
    if (!tracks.some((track) => track.getFile && !failed.has(id(track)))) {
      status = "allFailed";
      emit();
      return;
    }
    void advance(false, true);
  }
  async function select(
    track,
    autoplay = true,
    position = 0,
    recordHistory = true,
  ) {
    if (!track) return;
    const token = ++loading;
    release();
    current = track;
    bag = bag.filter((key) => key !== id(track));
    pendingPosition = Math.max(0, Number(position) || 0);
    if (recordHistory) record(track);
    if (!track.getFile) {
      status = "accessHint";
      persist();
      emit();
      return;
    }
    status = "loading";
    emit();
    try {
      const file = await track.getFile();
      if (token !== loading || disposed) return;
      audioURL = URL.createObjectURL(file);
      audio.src = audioURL;
      audio.load();
      if (autoplay) void play();
      else {
        status = "";
        emit();
      }
      const extra = await library.details(track, index).catch(() => ({
        title: track.title,
        artist: track.artist,
        album: track.album,
        lyrics: library.lyrics(""),
      }));
      if (token !== loading || disposed) return;
      Object.assign(track, {
        title: extra.title,
        artist: extra.artist,
        album: extra.album,
      });
      details = extra;
      if (extra.cover) coverURL = URL.createObjectURL(extra.cover);
      media();
      persist();
      emit();
    } catch (error) {
      if (token === loading && !disposed)
        failCurrent(
          error.name === "NotAllowedError" || error.name === "NotFoundError",
        );
    }
  }
  function nextTrack(previous = false, skipFailure = false) {
    const available = tracks.filter(
      (track) => track.getFile && !failed.has(id(track)),
    );
    if (!available.length) return null;
    if (mode === "shuffle") {
      if (previous && historyAt <= 0) return current;
      if (previous && historyAt > 0) {
        while (historyAt > 0) {
          const key = history[--historyAt];
          const track = tracks.find((item) => id(item) === key);
          if (track && !failed.has(id(track))) return track;
        }
      }
      if (!previous && historyAt < history.length - 1) {
        const key = history[++historyAt];
        const track = tracks.find((item) => id(item) === key);
        if (track && !failed.has(id(track))) return track;
      }
      bag = bag.filter((key) => available.some((track) => id(track) === key));
      if (!bag.length)
        bag = available.filter((track) => track !== current).map(id);
      if (!bag.length) return skipFailure ? null : available[0];
      const key = bag.splice(Math.floor(Math.random() * bag.length), 1)[0];
      return tracks.find((track) => id(track) === key);
    }
    const start = currentIndex();
    for (let offset = 1; offset <= tracks.length; offset++) {
      const raw = start + (previous ? -offset : offset);
      if (!previous && mode === "order" && raw >= tracks.length) return null;
      const track = tracks[(raw + tracks.length * 2) % tracks.length];
      if (available.includes(track)) return track;
    }
    return null;
  }
  async function advance(previous = false, skipFailure = false) {
    const track = nextTrack(previous, skipFailure);
    if (track)
      await select(
        track,
        true,
        0,
        mode !== "shuffle" || history[historyAt] !== id(track),
      );
    else {
      audio.pause();
      persist();
      emit();
    }
  }
  function seek(position) {
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = Math.max(0, Math.min(audio.duration, position));
      pendingPosition = 0;
      media();
      persist();
      emit();
    }
  }
  function setSleep(value) {
    clearTimeout(sleepTimer);
    sleep = value;
    deadline = 0;
    if (["15", "30", "60", "90"].includes(value)) {
      deadline = Date.now() + Number(value) * 60000;
      sleepTimer = setTimeout(expireSleep, Number(value) * 60000);
    }
    emit();
  }
  function expireSleep() {
    audio.pause();
    clearTimeout(sleepTimer);
    sleep = "off";
    deadline = 0;
    status = "sleepDone";
    emit();
  }
  async function scan(
    newHandle,
    files = [],
    name = directory,
    restore = false,
  ) {
    const token = ++scanning;
    readingTags = false;
    busy = true;
    count = 0;
    status = "scanning";
    emit();
    try {
      const result = await library.scan(newHandle, files, {
        cancelled: () => token !== scanning || disposed,
        progress: (value) => {
          count = value;
          emit();
        },
      });
      if (token !== scanning || disposed) return;
      const oldId = current && id(current),
        oldPosition = pendingPosition || audio.currentTime || 0,
        wasPlaying = !audio.paused;
      ++loading;
      release();
      const sameDirectory = directory === name;
      tracks = result.tracks;
      index = result.index;
      handle = newHandle;
      inputFiles = files;
      directory = name;
      current = sameDirectory
        ? tracks.find((track) => id(track) === oldId) || null
        : null;
      if (!sameDirectory) favorites = new Set();
      failed.clear();
      history = [];
      historyAt = -1;
      resetShuffle();
      busy = false;
      status = tracks.length ? "" : "emptyFolder";
      if (current)
        await select(current, restore ? false : wasPlaying, oldPosition);
      else if (tracks.length) await select(tracks[0], false);
      if (token !== scanning || disposed) return;
      persist();
      readingTags = true;
      emit();
      // Sequential optional tag work yields between files and never retains cover blobs.
      for (const track of tracks) {
        if (token !== scanning || disposed) return;
        try {
          const tags = await library.metadata(await track.getFile());
          if (token !== scanning || disposed) return;
          for (const key of ["title", "artist", "album"])
            if (tags[key]) track[key] = tags[key];
          emit();
        } catch {
          /* Missing tags are harmless. */
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      readingTags = false;
      persist();
      emit();
    } catch (error) {
      if (token !== scanning || disposed) return;
      busy = false;
      status = error.name === "AbortError" ? "cancelled" : "accessHint";
      emit();
    }
  }
  function cancelScan() {
    ++scanning;
    busy = false;
    readingTags = false;
    status = "cancelled";
    emit();
  }
  async function choose() {
    if (!window.showDirectoryPicker) return false;
    try {
      const selected = await window.showDirectoryPicker({
        mode: "read",
        id: "worktime-music",
        startIn: "music",
      });
      void scan(selected, [], selected.name);
      return true;
    } catch (error) {
      if (error.name === "AbortError") return true;
      if (
        error.name === "SecurityError" ||
        error.name === "TypeError" ||
        error.name === "NotSupportedError"
      )
        return false;
      status = "accessHint";
      emit();
      return true;
    }
  }
  async function rescan() {
    if (handle) {
      try {
        if (
          (await handle.queryPermission({ mode: "read" })) !== "granted" &&
          (await handle.requestPermission({ mode: "read" })) !== "granted"
        ) {
          status = "accessHint";
          emit();
          return false;
        }
        void scan(handle);
        return true;
      } catch {
        status = "accessHint";
        emit();
        return false;
      }
    }
    if (inputFiles.length) {
      void scan(null, inputFiles);
      return true;
    }
    return false;
  }
  function forget() {
    ++scanning;
    ++loading;
    busy = false;
    readingTags = false;
    release();
    setSleep("off");
    handle = null;
    inputFiles = [];
    directory = "";
    tracks = [];
    index.clear();
    current = null;
    pendingPosition = 0;
    favorites.clear();
    failed.clear();
    history = [];
    historyAt = -1;
    bag = [];
    status = "chooseHint";
    persist(true);
    media();
    emit();
  }
  const handlers = {
    loadedmetadata() {
      if (current) {
        delete current.error;
        failed.delete(id(current));
      }
      if (pendingPosition && Number.isFinite(audio.duration))
        audio.currentTime = Math.min(
          pendingPosition,
          Math.max(0, audio.duration - 0.01),
        );
      pendingPosition = 0;
      media();
      emit();
    },
    timeupdate() {
      if (deadline && Date.now() >= deadline) expireSleep();
      const second = Math.floor(audio.currentTime);
      if (Math.abs(second - lastSavedSecond) >= 5) {
        lastSavedSecond = second;
        persist();
      }
      if (second !== lastPublishedSecond) {
        lastPublishedSecond = second;
        media();
        emit();
      }
    },
    play() {
      media();
      emit();
    },
    pause() {
      persist();
      media();
      emit();
    },
    durationchange() {
      emit();
    },
    ratechange() {
      media();
      emit();
    },
    error() {
      if (audio.getAttribute("src")) failCurrent();
    },
    ended() {
      if (sleep === "track" || (deadline && Date.now() >= deadline))
        return expireSleep();
      if (mode === "one") {
        seek(0);
        void play();
      } else void advance();
    },
  };
  for (const [event, fn] of Object.entries(handlers))
    audio.addEventListener(event, fn);
  if ("mediaSession" in navigator)
    for (const [action, fn] of Object.entries({
      play: () => void play(),
      pause: () => audio.pause(),
      previoustrack: () => void advance(true),
      nexttrack: () => void advance(),
      seekto: (event) => seek(event.seekTime),
      seekbackward: (event) =>
        seek(audio.currentTime - (event.seekOffset || 10)),
      seekforward: (event) =>
        seek(audio.currentTime + (event.seekOffset || 10)),
    })) {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {
        /* Optional action. */
      }
    }
  async function restore() {
    try {
      const value = await storage.read();
      if (disposed) return;
      directory = typeof value.directory === "string" ? value.directory : "";
      tracks = Array.isArray(value.tracks)
        ? value.tracks.filter(
            (track) =>
              typeof track.path === "string" &&
              typeof track.fingerprint === "string",
          )
        : [];
      favorites = new Set(
        Array.isArray(value.favorites) ? value.favorites : [],
      );
      mode = ["list", "order", "one", "shuffle"].includes(value.mode)
        ? value.mode
        : "list";
      audio.volume = Number.isFinite(value.volume)
        ? Math.max(0, Math.min(1, value.volume))
        : 0.7;
      audio.muted = Boolean(value.muted);
      audio.playbackRate = Number.isFinite(value.rate)
        ? Math.max(0.5, Math.min(2, value.rate))
        : 1;
      current = tracks.find((track) => id(track) === value.current) || null;
      pendingPosition = Math.max(0, Number(value.position) || 0);
      handle = value.handle || null;
      if (tracks.length) status = "accessHint";
      emit();
      if (
        handle &&
        (await handle.queryPermission({ mode: "read" })) === "granted"
      )
        void scan(handle, [], directory, true);
    } catch {
      storageIssue = true;
      emit();
    }
  }
  const ready = restore();
  function onPageHide() {
    persist(true);
  }
  function onPageShow() {
    if (deadline && Date.now() >= deadline) expireSleep();
  }
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  return {
    ready,
    snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    choose,
    rescan,
    cancelScan,
    forget,
    importFiles(files) {
      const list = [...files];
      if (list.length)
        void scan(
          null,
          list,
          list[0].webkitRelativePath?.split("/")[0] || "files",
        );
    },
    select(track) {
      failed.clear();
      void select(track);
    },
    toggle() {
      if (audio.paused) {
        failed.clear();
        void play();
      } else audio.pause();
    },
    previous() {
      failed.clear();
      void advance(true);
    },
    next() {
      failed.clear();
      void advance();
    },
    seek,
    volume(value) {
      audio.volume = Math.max(0, Math.min(1, Number(value)));
      audio.muted = false;
      persist();
      emit();
    },
    mute() {
      audio.muted = !audio.muted;
      persist();
      emit();
    },
    rate(value) {
      audio.playbackRate = Math.max(0.5, Math.min(2, Number(value)));
      persist();
    },
    mode(value) {
      if (["list", "order", "one", "shuffle"].includes(value)) {
        mode = value;
        history = current ? [id(current)] : [];
        historyAt = history.length - 1;
        resetShuffle();
        persist();
        emit();
      }
    },
    favorite(track) {
      const key = id(track);
      if (favorites.has(key)) favorites.delete(key);
      else favorites.add(key);
      persist();
      emit();
    },
    isFavorite(track) {
      return favorites.has(id(track));
    },
    setSleep,
    dispose() {
      persist(true);
      ++loading;
      ++scanning;
      disposed = true;
      clearTimeout(sleepTimer);
      clearTimeout(saving);
      for (const [event, fn] of Object.entries(handlers))
        audio.removeEventListener(event, fn);
      release();
      listeners.clear();
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      if ("mediaSession" in navigator) {
        for (const action of [
          "play",
          "pause",
          "previoustrack",
          "nexttrack",
          "seekto",
          "seekbackward",
          "seekforward",
        ])
          try {
            navigator.mediaSession.setActionHandler(action, null);
          } catch {
            /* Optional. */
          }
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      }
    },
  };
};
