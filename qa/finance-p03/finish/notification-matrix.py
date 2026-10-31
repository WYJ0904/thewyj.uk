"""Original eight OS callback cases with fresh output and nonempty optional ADB args.

After instrumentation, explicitly launch the owned app in ordinary mode before
testing ordinary-mode callbacks. Three controlled sequences document why a
receiver-only rebind is not a sufficient preparation. Original case inputs,
assertions and callback deadlines are unchanged.
"""
from pathlib import Path
import sys
sys.dont_write_bytecode=True
root=Path(__file__).resolve().parents[3]
source=root/'qa/finance-p03/device/notification-matrix.py'
code=source.read_text().replace("/finance-p03/device'","/finance-p03/finish'")
lines=[]
for line in code.splitlines():
    if line=="    control('bind')":
        lines += [
            "    assert not phone.state(s)['formal_nls_enabled']",
            "    started=phone.run('-s',s,'shell','am','start','--user','0','-n',phone.PKG+'/uk.thewyj.app.MainActivity','-d','thewyj://app?route=%2Ffinance')",
            "    (dest/'normal-start.json').write_text(json.dumps({'explicit_ordinary_mode_start':True,'output':started,'boundary_evidence':'../nls-instrumentation-boundary/runs.json','assertions_or_timeouts_changed':False}),encoding='utf8')",
            line,
        ]
    elif line.strip().startswith("output=phone.run('-s',s,'shell','am','broadcast'"):
        lines += [
            "        assert not phone.state(s)['formal_nls_enabled']",
            "        args=['-s',s,'shell','am','broadcast','--user','0','--include-stopped-packages','-n',phone.PKG+'/uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver','--es','operation',op,'--ei','variant',str(variant)]",
            "        if tag:args+=['--es','tag',tag]",
            "        output=phone.run(*args)",
        ]
    else:lines.append(line)
exec(compile('\n'.join(lines),str(source),'exec'),globals())
