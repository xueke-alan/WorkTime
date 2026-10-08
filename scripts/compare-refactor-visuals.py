"""Compare preserved refactor screenshots with a separate current capture (Pillow)."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops

root = Path(__file__).resolve().parent.parent
stable = "--stable" in sys.argv
run_id = next((arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("--run-id=")), "")
baseline_id = next((arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("--baseline-run-id=")), run_id)
for identifier in (run_id, baseline_id):
    if identifier and any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in identifier):
        raise ValueError("Invalid capture run identifier")
suffix = "-" + run_id if run_id else ""
baseline_suffix = "-" + baseline_id if baseline_id else ""
baseline = root / ".refactor-backups" / (("visual-stable-baseline-2026-10-04" if stable else "visual-baseline-2026-10-04") + baseline_suffix)
current = root / "test-results" / (("visual-stable-current-2026-10-04" if stable else "visual-current-2026-10-04") + suffix)
output = current / "comparison.json"
if output.exists():
    raise FileExistsError("Refusing to replace existing visual comparison")
manifest = json.loads((baseline / "manifest.json").read_text(encoding="utf-8"))
current_manifest = json.loads((current / "manifest.json").read_text(encoding="utf-8"))
for field in ("date", "timezone", "stable", "paint", "nativeClock", "cdp", "isolatedThemeContexts", "fullPagePaintWarmup", "randomSeed", "resetRandomSeedOnResize", "runnerIdentity"):
    if manifest.get(field) != current_manifest.get(field):
        raise ValueError("Incompatible capture setting: " + field)
def cases(document):
    result = []
    for sample in document["samples"]:
        name = sample["file"]
        if Path(name).name != name or not name.endswith(".png"):
            raise ValueError("Unsafe screenshot filename")
        if sample.get("errors"):
            raise ValueError("Capture contains page errors: " + name)
        result.append((name, sample["theme"], sample["width"], sample["view"]))
    if not result or len({row[0] for row in result}) != len(result):
        raise ValueError("Empty or duplicate capture cases")
    return result
if cases(manifest) != cases(current_manifest):
    raise ValueError("Baseline and current capture cases differ")
rows = []
for sample in manifest["samples"]:
    name = sample["file"]
    with Image.open(baseline / name) as before, Image.open(current / name) as after:
        row = {"file": name, "beforeSize": before.size, "afterSize": after.size}
        if before.size == after.size:
            diff = ImageChops.difference(before.convert("RGB"), after.convert("RGB"))
            row["bounds"] = diff.getbbox()
            changed = sum(1 for pixel in zip(*[channel.tobytes() for channel in diff.split()]) if pixel != (0, 0, 0))
            row["changedPixels"] = changed
            row["changedPercent"] = round(100 * changed / (before.width * before.height), 4)
        rows.append(row)
with output.open("x", encoding="utf-8") as destination:
    destination.write(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"samples": len(rows), "identical": sum(row.get("changedPixels") == 0 for row in rows), "report": str(output)}))
