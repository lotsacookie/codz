import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const python = process.env.PYTHON || 'python3';
const script = resolve('.tools/reference-pack/zone-assets.py');
const hasPython = spawnSync(python, ['--version']).status === 0;

const report = code => execFileSync(python, ['-I', '-c', `
import importlib.util, sys
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location('zone_assets', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
${code}
`, script], { encoding: 'utf8' });

test('error report names the failed asset, the asset before it and the stop point', { skip: !hasPython }, () => {
  const text = report(`
zone = SimpleNamespace(
    data=bytes(range(256)) * 4, pos=300,
    failed_spans=[{"index": 2, "type": "XAnimParts", "error": "stream exhausted at 0x64", "start": 100, "end": 140, "resyncedTo": 3}],
    soft_errors=[{"where": "x"}], poison_events=[(20, "Font_s.material->Material")],
    assets=[(1, "RawFile", "a.gsc", None), (3, "XAnimParts", "anim_a", None), (3, "XAnimParts", None, None)],
    asset_spans=[{"index": 1, "type": "XAnimParts", "start": 40, "end": 99}],
)
sys.stdout.write(module.build_error_report("demo", zone, "ok", None, ["  asset#2 (XAnimParts) failed (x); resyncing"]))
`);
  assert.match(text, /# error report: demo/);
  assert.match(text, /errors: 4 \(1 failed assets, 1 soft errors, 1 poisoned pointers\)/);
  assert.match(text, /FAILED ASSET #2 XAnimParts/);
  assert.match(text, /previous walked asset: #1 XAnimParts anim_a stream=0x28\.\.0x63/);
  assert.match(text, /note: previous asset ended at 0x63 but this one started at 0x64/);
  assert.match(text, /POISONED POINTER Font_s\.material->Material/);
  assert.match(text, /WALK STOPPED at 0x12c/);
  assert.match(text, /## raw walker output\n {2}asset#2 \(XAnimParts\) failed/);
});

test('error report still explains a zone that could not be opened', { skip: !hasPython }, () => {
  const text = report('sys.stdout.write(module.build_error_report("bad", None, "walk-error", "ZoneError: not a T5 fastfile", []))');
  assert.match(text, /status: walk-error/);
  assert.match(text, /zone could not be opened/);
});
