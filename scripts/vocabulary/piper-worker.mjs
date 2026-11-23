import { initialize, wav, ort, files } from "./speech-runtime.mjs";
import { phonemize } from "phonemizer";

const sessions = new Map();
const configurations = new Map();
async function generate(data) {
  if (data.accent !== "uk" || data.voice !== "en_GB-jenny_dioco-medium")
    throw Error("Invalid Piper voice");
  const prefix = "en/en_GB/jenny_dioco/medium/";
  if (data.speed !== 1 || data.speaker !== 0 || data.noiseScale !== 0.5 || data.noiseW !== 0.333)
    throw Error("Invalid Piper profile");
  const filename = prefix + data.voice + ".onnx";
  if (!sessions.has(data.voice)) {
    const config = JSON.parse(new TextDecoder().decode(files[filename + ".json"]));
    if (config.phoneme_type !== "espeak" || config.audio.sample_rate !== 22050)
      throw Error("Unsupported Piper configuration");
    configurations.set(data.voice, config);
    sessions.set(data.voice, await ort.InferenceSession.create(files[filename], {
      executionProviders: ["wasm"], graphOptimizationLevel: "all",
    }));
  }
  const config = configurations.get(data.voice);
  const sentences = await phonemize(data.text, config.espeak.voice);
  const chunks = [];
  for (const sentence of sentences) {
    const ids = [...config.phoneme_id_map["^"], ...config.phoneme_id_map["_"]];
    for (const phone of sentence.normalize("NFD")) {
      const mapped = config.phoneme_id_map[phone];
      if (!mapped) throw Error("Unsupported Piper phoneme: " + phone);
      ids.push(...mapped, ...config.phoneme_id_map["_"]);
    }
    ids.push(...config.phoneme_id_map["$"]);
    const feeds = {
      input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor("float32", Float32Array.from([data.noiseScale, 1 / data.speed, data.noiseW]), [3]),
    };
    if (config.num_speakers > 1)
      feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(data.speaker)]), [1]);
    const result = await sessions.get(data.voice).run(feeds);
    chunks.push(new Float32Array(result.output.data));
    for (const tensor of Object.values(feeds)) tensor.dispose();
    for (const tensor of Object.values(result)) tensor.dispose();
  }
  const pcm = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { pcm.set(chunk, offset); offset += chunk.length; }
  if (!pcm.length || !pcm.every(Number.isFinite)) throw Error("Invalid Piper audio");
  return wav(pcm, config.audio.sample_rate);
}
let serial = Promise.resolve();
self.onmessage = ({ data }) => {
  serial = serial.then(async () => {
    try {
      if (data.type === "init") {
        initialize(data);
        self.postMessage({ id: data.id, type: "ready" });
      } else {
        const buffer = await generate(data);
        self.postMessage({ id: data.id, type: "audio", buffer }, [buffer]);
      }
    } catch (error) {
      self.postMessage({ id: data.id, type: "error", message: String(error) });
    }
  });
};
