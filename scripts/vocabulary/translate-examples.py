"""Explicit developer-only offline translation; no model is shipped with the site."""
import hashlib
import json
from pathlib import Path
import sys
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--batch-size", type=int, default=16)
parser.add_argument("--beam-size", type=int, default=4)
parser.add_argument("--max-length", type=int, default=192)
args = parser.parse_args()
if min(args.batch_size, args.beam_size, args.max_length) < 1:
    parser.error("translation parameters must be positive")

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache/vocabulary"
sys.path.insert(0, str(CACHE / "python"))
import ctranslate2  # noqa: E402
import sentencepiece  # noqa: E402

model = CACHE / "translation-model"
source = sentencepiece.SentencePieceProcessor(model_file=str(model / "source.spm"))
target = sentencepiece.SentencePieceProcessor(model_file=str(model / "target.spm"))
translator = ctranslate2.Translator(str(model), device="cpu", compute_type="int8", inter_threads=1, intra_threads=4)
cache_file = CACHE / "example-translations.json"
translations = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else {}
preview = json.loads((CACHE / "examples-preview.json").read_text(encoding="utf-8"))
sentences = list(dict.fromkeys(example["en"] for examples in preview.values() for example in examples if example.get("translation", {}).get("type") == "machine"))
pending = [en for en in sentences if hashlib.sha256(en.encode()).hexdigest() not in translations]
pending.sort(key=len)
print(f"Local translation pending: {len(pending)}", flush=True)
for offset in range(0, len(pending), args.batch_size):
    batch = pending[offset:offset + args.batch_size]
    tokens = [source.encode(en, out_type=str) + ["</s>"] for en in batch]
    results = translator.translate_batch(tokens, beam_size=args.beam_size, max_decoding_length=args.max_length, no_repeat_ngram_size=3)
    for en, result in zip(batch, results):
        zh = target.decode(result.hypotheses[0]).strip()
        if not any("\u3400" <= c <= "\u9fff" for c in zh):
            raise ValueError(f"No Chinese translation: {en}")
        translations[hashlib.sha256(en.encode()).hexdigest()] = {"en": en, "zh": zh, "provider": "Helsinki-NLP OPUS-MT", "url": "https://huggingface.co/Helsinki-NLP/opus-mt-en-zh"}
    temporary = cache_file.with_suffix(".tmp")
    temporary.write_text(json.dumps(translations, ensure_ascii=False), encoding="utf-8")
    temporary.replace(cache_file)
    if offset % 256 == 0 or offset + len(batch) >= len(pending):
        print(f"Local translation: {min(offset + len(batch), len(pending))}/{len(pending)}", flush=True)
