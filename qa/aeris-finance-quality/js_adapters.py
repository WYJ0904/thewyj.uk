"""Import/root/evidence-path adapters, with reversible replacement provenance."""
from common import *
import re

def adapt_js(source, destination, extra=()):
    source=ROOT/source
    original=source.read_text(encoding='utf-8');modified=original;replacements=[]
    patterns=[r'\bfrom\s*([\"\'])(\.\.?/[^\"\']+)\1',r'\bimport\s*\(\s*([\"\'])(\.\.?/[^\"\']+)\1\s*\)']
    for pattern in patterns:
        for match in re.finditer(pattern,original):
            old=match.group(0);uri=(source.parent/match[2]).resolve().as_uri()
            new=('from '+json.dumps(uri)) if old.startswith('from') else ('import('+json.dumps(uri)+')')
            if old not in [x[0] for x in replacements]:replacements.append((old,new))
    # Module ancestry changes in the new driver directory; the repository does not.
    for match in re.finditer(r'path\.resolve\(import\.meta\.dirname,\s*([\"\'])(?:\.\./?)+\1\)',original):
        replacements.append((match.group(0),json.dumps(str(ROOT).replace('\\','/'))))
    for old,new in extra:
        assert old in original,(source,old)
        replacements.append((old,new))
    for old,new in replacements:
        modified=modified.replace(old,new)
    destination.parent.mkdir(parents=True,exist_ok=True)
    assert not destination.exists();destination.write_text(modified,encoding='utf-8')
    return dict(source=source.relative_to(ROOT).as_posix(),source_sha256=sha(source),
                dest=destination.relative_to(ROOT).as_posix(),dest_sha256=sha(destination),
                replacements=[dict(before=a,after=b) for a,b in replacements])
