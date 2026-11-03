"""Post-hoc accuracy and provenance audit; this program never calls an OCR SDK."""
from pathlib import Path
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[2]
E = ROOT / 'docs/migration-evidence/aeris-p0-ocr'
p = argparse.ArgumentParser()
p.add_argument('--input', default='samsung-r2')
p.add_argument('--label', default='evaluation-r1')
a = p.parse_args()
assert re.fullmatch(r'samsung-r[1-9][0-9]*', a.input)
assert re.fullmatch(r'evaluation-r[1-9][0-9]*', a.label)
src = E / a.input
out = E / a.label
out.mkdir(exist_ok=False)
sha = lambda file: hashlib.sha256(Path(file).read_bytes()).hexdigest()
read = lambda name: json.loads((src / name).read_text(encoding='utf8'))

# Truth is used only AFTER device results were collected and QA was removed.
ORIGINAL = 'SYNTH-P06-JOINT-123456'
TRUTH = {
    'letters': ['ABCDEFGHJKLMNPQR'],
    'digits': ['202610260123456789'],
    'mixed': ['AB0O1I2LZ2026'],
    'original-alpha': [ORIGINAL],
    'low-resolution': ['AB0O1I2LZ2026'],
    'blurred': ['AB0O1I2LZ2026'],
    'occluded': ['AB0O1I2LZ2026'],
    'duplicate-references': ['202610260123456789', 'OTHER-REF-987654'],
}
LABEL = re.compile(r'(?:交易号|交易號|订单号|訂單號|参考号|參考號|reference|transaction)\s*[:：]?\s*([A-Za-z0-9_-]+)', re.I)
OPAQUE = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{5,}')


def candidates(lines):
    found = []
    for line in lines:
        labelled = LABEL.search(line)
        if labelled:
            found.append(labelled[1])
        elif OPAQUE.fullmatch(line.strip()):
            found.append(line.strip())
    return list(dict.fromkeys(found))


def observation(lines, truth):
    values = candidates(lines)
    return dict(raw_lines=lines, raw_candidates=values,
                whole_reference_set_exact=sorted(values) == sorted(truth),
                exact_single_reference=len(truth) == 1 and values == truth,
                expected_substrings_seen=[value for value in truth if any(value in line for line in lines)])


device = read('result.json')
assert device['status'] == 'EXECUTED_ACCURACY_TO_BE_EVALUATED'
assert device['formal_state_unchanged'] and device['qa_packages_absent_after']
assert all(item['uninstalled'] for item in device['cleanup'])
assert all(item['junit_pass'] for item in device['runs'])
assert all(device[key] == 0 for key in ['activity_launches', 'screen_captures', 'private_pages_read',
                                       'external_model_calls', 'ledger_writes_by_probe', 'production_operations'])
build = json.loads((E / device['build_evidence']).read_text(encoding='utf8'))
assert sha(E / device['build_evidence']) == device['build_manifest_sha256']
assert build['status'] == 'PASS' and build['source_stable']
for name, digest in build['source_before'].items():
    assert sha(ROOT / name) == digest, 'Source changed after building: ' + name
assert build['source_before']['qa/aeris-finance-quality/sdk/ReferenceOcrProbeTest.kt'] == '2c6ff27bf9d4839dc7bdc17c828e3a10767a2a2010993f61ca241eebe71c2949'
assert sha(ROOT / 'qa/aeris-finance-quality/sdk/assets/reference-original.png') == '46e6442173c53550e68f06bc8bbed7cb88557a751c8f244a9baa75100ff4c68f'

six = read('original-six/views.json')
corpus = read('corpus/results.json')
latin = read('latin-corpus/results.json')
geometry = read('geometry/results.json')
cold = read('cold-direct/results.json')
assert len(six) == 6 and len(corpus) == 8 and len(latin) == 14
assert set(row['id'] for row in corpus) == set(TRUTH)
assert all(row['status'] == 'EXECUTED' and not row['expected_reference_hint'] and row['ledger_writes'] == 0 for row in latin)
frozen_six = [dict(view=row['view'], **observation(row['lines'], [ORIGINAL])) for row in six]
frozen_eight = [dict(id=row['id'], safety_status=row['status'], decoder_exact=row['decoder_exact'],
                     **observation(row['sdk_lines'], TRUTH[row['id']])) for row in corpus]
latin_rows = []
for row in latin:
    folder = 'original-six' if row['group'] == 'original-six' else 'corpus'
    file = src / folder / (row['view'] + '.png')
    assert sha(file) == row['input_sha256'], 'Latin input differs from the frozen specimen'
    truth = [ORIGINAL] if folder == 'original-six' else TRUTH[row['view']]
    latin_rows.append(dict(group=folder, view=row['view'], input_sha256=row['input_sha256'],
                           elapsed_ms=row['elapsed_ms'], **observation(row['lines'], truth)))
geometry_rows = []
for row in geometry + cold:
    folder = 'cold-direct' if row in cold else 'geometry'
    assert row['status'] == 'EXECUTED' and not row['expected_reference_hint'] and row['ledger_writes'] == 0
    assert sha(src / folder / (row['view'] + '.png')) == row['png_sha256']
    geometry_rows.append(dict(model=row['model'], view=row['view'], input_sha256=row['png_sha256'],
                              width=row['width'], height=row['height'], rotation=row['input_rotation'],
                              elapsed_ms=row['elapsed_ms'], **observation([line['text'] for line in row['lines']], [ORIGINAL])))
agreements = []
for old in frozen_eight:
    other = next(row for row in latin_rows if row['group'] == 'corpus' and row['view'] == old['id'])
    values = old['raw_candidates']
    if values and values == other['raw_candidates']:
        agreements.append(dict(id=old['id'], raw_candidates=values,
                               reference_set_exact=old['whole_reference_set_exact']))
summary = dict(frozen_six=dict(cases=6, whole_reference_exact=sum(row['exact_single_reference'] for row in frozen_six)),
               frozen_eight=dict(cases=8, safety_pass=sum(row['safety_status'] == 'PASS' for row in frozen_eight),
                                 exact_single_binding=sum(row['decoder_exact'] for row in frozen_eight)),
               latin_six=dict(cases=6, whole_reference_exact=sum(row['exact_single_reference'] for row in latin_rows if row['group'] == 'original-six')),
               latin_eight=dict(cases=8, whole_reference_set_exact=sum(row['whole_reference_set_exact'] for row in latin_rows if row['group'] == 'corpus'),
                                 exact_single_reference=sum(row['exact_single_reference'] for row in latin_rows if row['group'] == 'corpus')),
               geometry={model: dict(cases=sum(row['model'] == model for row in geometry_rows if row['view'] != 'cold-source'),
                                      whole_reference_exact=sum(row['model'] == model and row['exact_single_reference'] for row in geometry_rows if row['view'] != 'cold-source'))
                         for model in ['chinese', 'latin']},
               cross_model_agreed_but_wrong=sum(not row['reference_set_exact'] for row in agreements))
result = dict(status='VERIFIED_EVIDENCE_NOT_A_RELEASE_PASS', source_head=build['head'], summary=summary,
              frozen_six=frozen_six, frozen_eight=frozen_eight, latin_same_pixels=latin_rows,
              geometry_and_cold=geometry_rows, cross_model_identical_candidates=agreements,
              raw_file_hashes={str(file.relative_to(src)): sha(file) for file in sorted(src.rglob('*')) if file.is_file()},
              formal_version_and_sensitive_permission_configuration_unchanged=device['formal_state_unchanged'],
              new_qa_packages_absent=device['qa_packages_absent_after'], expected_values_posthoc_only=True,
              product_changed=False, automatic_binding_or_booking_authorized=False,
              device_lifecycle_scope='Fresh QA process and QA force-stop/restart only; no reboot, screen-off, Activity, permission or real-payment acceptance')
(out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(summary))
