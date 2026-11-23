# Vocabulary content

The application reads the static `assets/data/vocabulary/catalog.js`; no dictionary,
translation service, Python package or translation model is needed at runtime.

## Refresh workflow

1. `npm run prepare:vocabulary` normally rebuilds from the reviewed snapshots below.
   For the first source refresh, ensure the pinned ECDICT CSV is in
   `.cache/vocabulary/ecdict.csv` (the normal preparation command downloads it).
2. `node scripts/vocabulary/import-dictionary.cjs --full` extracts the union of the
   six target word lists directly from ECDICT, including the `ky` tag mapped to
   `kaoyan`. The importer no longer needs an already-generated catalog. The full
   compressed download supports resumable, snapshot-checked ranges.
3. `node scripts/vocabulary/import-simple.cjs` supplements missing accents and
   examples from Simple English Wiktionary, retaining per-entry provenance.
4. `node scripts/vocabulary/import-wordnet.cjs` extracts short sentences and phrases
   from the pinned Open English WordNet 2025 archive. Only initial capitalization
   and sentence-final punctuation are normalized. Dictionary import excludes
   published quotations and collects examples of two to eight words.
5. `node scripts/vocabulary/import-examples.cjs --inventory` writes a developer
   preview and gap list. It combines the current complete snapshot with curated
   `short-originals.json`, `short-phrase-examples.json`, and `short-supplement.tsv`.
   Dedicated pronunciation entries never inherit examples of another reading.
   Optional local `short-dictionary.json` and `short-tatoeba.json` candidate pools
   can supply additional attributed source examples. They are not build inputs.
6. `node scripts/vocabulary/translate-short-examples.cjs --preview` explicitly
   translates public English draft examples online into a developer cache. The
   optional local translator below can fill the same cache. No online translation
   runs during a build or in the application. Then run
   `node scripts/vocabulary/import-examples.cjs` to publish `examples.json` only
   when every entry and translation passes the policy. An incomplete refresh
   preserves the previous application snapshot. Editorial text and reviewed
   translation overrides take priority over machine output.
7. `npm run prepare:vocabulary` and `npm run prepare:assets` rebuild application
   resources. Run `node scripts/vocabulary/audit-content.cjs` for an independent,
   deterministic 200-entry book-balanced Oxford IPA comparison, plus split senses.
8. Run `node scripts/verify-vocabulary.cjs --unit`, the browser vocabulary/cache
   checks, and `node scripts/verify-vocabulary-examples.cjs` for complete lists,
   exact playback strings and mobile wrapping. After preparing the release, run
   the latter with `_site` to test the published offline entry too. Run
   `npm run check`, `npm run lint`, and `npm run check:format`.

## Optional local translation

`translate-examples.py` fills the same translation cache locally. Install Python
3.12 packages `ctranslate2==4.6.2`, `sentencepiece==0.2.1`, and `numpy==2.2.6` into
`.cache/vocabulary/python`. Download `model.bin`, `config.json`,
`shared_vocabulary.json`, `source.spm`, and `target.spm` from
[the pinned CTranslate2 conversion](https://huggingface.co/gaudi/opus-mt-en-zh-ctranslate2/tree/dcd22168f08b99dd34c62bc2195e31dc2f04e90b)
into `.cache/vocabulary/translation-model`, then run:

```
node scripts/vocabulary/import-examples.cjs --inventory
python scripts/vocabulary/translate-examples.py
node scripts/vocabulary/import-examples.cjs
```

Models and Python packages remain disposable developer caches. Translation
provider and review status travel with each example. Machine translation is never
represented as a human-reviewed translation.

## Short example policy

Every catalog entry, including scenario expressions, has at least three unique
bilingual examples. Each English example has at most eight whitespace-delimited
words, with two to six preferred. At most one example per entry may be a phrase;
the others are complete sentences, including ordinary imperative sentences.
`kind` explicitly distinguishes `sentence` and `phrase`; punctuation alone does
not establish that a phrase is a sentence. Source candidate classification is a
conservative drafting aid, not grammatical certification.

Common polysemous words receive four to six examples covering distinct common
meanings. `sense` and existing dictionary glosses guide selection. Do not pad
coverage with duplicate sentences, arbitrary truncation, or mechanically varied
pronouns. The original supplement contains complete authored sentences with
matching Chinese translations; examples may naturally illustrate several words.
Known unsuitable source examples are recorded in `excluded-examples.json`.

The English Tatoeba additions use the 2026-11-21 detailed export, SHA-256
`3a0e7a2fdd7cbad76f226de4c28371a15a2fc4d115001617288b16a35c6293db`.
Contributor names and source URLs remain attached to individual examples.
Normal regeneration uses the checked-in bilingual snapshot and needs neither
this raw export nor its parsing tools. English and Chinese text are never
silently sliced in the UI; playback uses the exact displayed English string.

## Reports and limits

`pronunciation-corrections.json` corrects display IPA without changing learning
card IDs. The generated-IPA label describes only the transcription source, not
the quality of model audio.

- `pronunciation-report.json`: accent source counts, changes against the local
  pre-change catalog baseline, speech-adapter fallbacks, and generated entries.
- `example-report.json`: bilingual coverage, sources, book counts, minimum examples,
  maximum word count, and total phrase count. Every entry is validated at build time.
- `example-audit.json`: a reproducible 200-entry editorial sample, including retained
  sources and hashes of the checked English and Chinese text. This is an assistant
  review, not an independent human assessment; other machine translations remain
  explicitly unreviewed.
- `content-audit.json`: normalized agreement with an independent Oxford reference.
  Dictionary variation and unavailable references remain review items; source
  coverage and agreement are not a population accuracy estimate.
- `example-gaps.json`: refresh-time missing examples; must be empty for this release.

All source snapshots include provenance and checksums. Per-example credit and
license information is retained in the catalog; the learning card omits inline
source notes. See licenses/vocabulary.txt for credits and license information.
ECDICT examination labels do not claim complete coverage of a particular year's
official examination syllabus.

## Fixed offline speech

US uses Supertonic 3 F1 (16 steps, speed 1.05, 44,100 Hz PCM).
UK uses Piper en_GB-jenny_dioco-medium (speed 1, noise_scale 0.5,
noise_w 0.333, 22,050 Hz PCM). There are no model selectors. Legacy model
preferences are ignored and removed. Only these voices are supported;
recognized retired voice caches are cleaned up, with current audio preserved.

`npm run prepare:speech` builds the lightweight runtime and pinned model manifest
without downloading model binaries. First foreground speech downloads the needed
engine from its pinned Hugging Face revision, verifies SHA-256, and saves it in
english/resources-piper/ or english/resources-supertonic-3/. Settings can download
both engines or cancel an active download. Background synthesis reuses installed
models and never initiates a model download. Network transfer does not hold the
runtime-folder lock. Existing hash-addressed resources remain compatible.

`npm run package:speech` creates a separate `.wtmodels` package under
.cache/speech-packages/. Use `-- --engine=piper` or `-- --engine=supertonic`
for one engine, or `-- --output=PATH` for another output path. This versioned,
uncompressed format contains a bounded JSON manifest followed by original model
bytes. Import it in vocabulary settings. Every entry and the complete package are
verified before any file is installed. Packages are local artifacts, not Git
assets. This supports first-use offline speech after manually installing a package.
Audio caches remain separate and do not enter learning backups.

Validate offline synthesis, cache reuse and removal of legacy choices with
`node scripts/verify-vocabulary-models.cjs`; test actual offline synthesis using
`npm run check:speech -- --http --with-folder --package=.cache/speech-packages/worktime-speech-models-v1.wtmodels`.
Append `--background` to exercise both idle engines.
Samples are written under .cache/speech-previews/. These checks verify operation,
not human pronunciation accuracy. See licenses/piper.txt and licenses/supertonic.txt.

Idle cache priority has eight phases: today's due/new/already-studied words in
the selected accent, then the other accent; all examples of those words in the
selected accent, then the other accent; remaining catalog words in the selected
accent, then the other accent; remaining examples in the selected accent, then
the other accent. Examples retain catalog and display order within each phase,
including phrase examples. Both the queue and overall progress deduplicate by
the full audio identity across words and examples. Example text matches manual
playback exactly, so existing recordings are reused. Foreground speech retains
priority, and changes to learning records, settings or the local date rebuild
the priority queue without discarding cached audio.
