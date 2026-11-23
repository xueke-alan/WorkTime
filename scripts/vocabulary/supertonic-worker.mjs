import { initialize, wav } from "./speech-runtime.mjs";
import { loadTextToSpeech, loadVoiceStyle } from "./vendor/supertonic.mjs";
let tts;
const voices = new Map();
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      initialize(data);
      const loaded = await loadTextToSpeech("onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      tts = loaded.textToSpeech;

      self.postMessage({ id: data.id, type: "ready" });
    } else {
      if (data.accent !== "us" || data.voice !== "F1" || data.steps !== 16 || data.speed !== 1.05) throw Error("Invalid speech profile");
      if (!voices.has(data.voice)) voices.set(data.voice, await loadVoiceStyle(["voice_styles/"+data.voice+".json"]));
      const result = await tts.call(data.text, "en", voices.get(data.voice), data.steps, data.speed);
      const buffer = wav(result.wav.slice(0, Math.ceil(result.duration[0] * tts.sampleRate)), tts.sampleRate);
      self.postMessage({ id: data.id, type: "audio", buffer }, [buffer]);
    }
  } catch (error) { self.postMessage({ id: data.id, type: "error", message: String(error) }); }
};
