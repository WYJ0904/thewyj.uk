# P3.1 owner acceptance correction

> Historical P3.1 correction: owner visual/product acceptance **FAIL**. Restoring
> information as new grids and link rows did not restore the accepted UI.
> Task 19 and exact P2 `b8c1715` Card/Accordion composition take precedence.
> See `P3_2_CARD_RESTORATION_AUDIT.md`; the original findings below are retained.

Compared P2 `b8c1715e5d5c5069de162c1b35a737548bdcb29a` with P3 `82771cc1e194d5d9339ee1119bafa99422d5f8dd` before editing. P3 removed three hero scenes, the fifth account capability, the privacy/local-processing band and the three plan categories. Four working Product Window panels alone were insufficient to preserve the public product explanation.

P3 initial closure passed technical gates but failed owner visual/product acceptance because the public homepage removed too much of the P2 information architecture. P3.1 restored the information architecture without reverting P3 branding or interaction improvements.

| P2 information | P3.1 implementation |
| --- | --- |
| Japanese/finance/tools hero scenes | Three compact, static Aeris scene cards leading to the existing local Product Window. The learning item is explicitly a demo; finance has no fake account balance. |
| Learning/tools/finance/share/account | Five visible link rows using existing site navigation/auth handlers. No hover dependency or second business state owner. |
| Privacy/local handling | Specific browser-local trial/preview operations, account sync/upload distinction, and anonymous/official learning data separation. |
| Free/module/permanent categories | Three categories; paid rows render the existing membership owner's live `/api/membership/plans` response. No hardcoded prices or new payment flow. |
| Final action area | Login/register/Android download/changelog through existing handlers. |

Preserve the P3 Product Window, Launchpad, original Aeris assets and Android resources, schemas and persistent identities, P1/P2 interaction contracts, upload watchdog, and stable CI staging. No P4 work. Validate all sections and business entry routes, not only the absence of old hero class names.
