"""Independent Decimal oracle shared by JS and Android; synthetic values only."""
from decimal import Decimal, localcontext, ROUND_HALF_EVEN
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
digits = dict(CNY=2, USD=2, EUR=2, HKD=2, GBP=2, JPY=0)
cases = []
with localcontext() as context:
    context.prec = 100
    for base, base_digits in digits.items():
        for quote, quote_digits in digits.items():
            for minor, rate in [(0, '7'), (1, '0.5'), (-3, '0.5'), (12345, '7.000000000000000001'),
                                (-12345, '1e-18'), (9007199254740991, '1000000000000')]:
                amount = Decimal(minor).scaleb(-base_digits)
                converted = minor if base == quote else int((amount * Decimal(rate)).scaleb(quote_digits).quantize(Decimal(1), rounding=ROUND_HALF_EVEN))
                cases.append(dict(id=f'{base}-{quote}-{len(cases):03}', base=base, quote=quote, minor=minor, rate=rate,
                                  expected=converted if abs(converted) <= 9007199254740991 else None, overflow=abs(converted) > 9007199254740991))
target = ROOT / 'qa/finance-p04/fixtures/exact-oracle.json'
target.parent.mkdir(parents=True, exist_ok=True)
generated = json.dumps(dict(oracle='Python Decimal precision 100; ROUND_HALF_EVEN; one destination rounding', synthetic_only=True, cases=cases), indent=2)+'\n'
if '--check' in sys.argv:
    assert target.read_text() == generated, 'Frozen oracle differs from independent Decimal reconstruction'
else:
    target.write_text(generated)
print(f'{len(cases)} deterministic exact conversion expectations')
