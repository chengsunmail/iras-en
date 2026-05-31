# iRAS

> An open-source engineering design platform for Recirculating Aquaculture Systems (RAS)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
![Version](https://img.shields.io/badge/version-1.7.0-green.svg)
![Status](https://img.shields.io/badge/status-stable-brightgreen.svg)

**iRAS** is an open-source engineering tool for designing Recirculating Aquaculture Systems, built for **aquaculture engineers, design firms, and academic researchers**. It covers the full workflow: **process design → P&ID generation → equipment schedule → investment & financial evaluation**.

It runs entirely in the browser — no installation, no backend, no account.

> **English edition.** iRAS (English edition) v1.7.0 was initially ported from the original Chinese edition (v1.7). The two editions are maintained as independent repositories and developed independently from this point onward.

---

## Why iRAS

RAS design couples biology, water chemistry, thermodynamics, and capital cost in ways that spreadsheets handle poorly. iRAS solves the steady-state mass balance and equipment sizing as a connected system, so a change in stocking density, temperature, or recycle topology propagates through water quality, equipment selection, P&ID, and cost in one pass. The physics is calibrated against published literature and industry data, and every formula is documented in the code.

---

## Features

### Process design & engineering
- **Multi-stage production scale-up** (tailwater mass conservation + Little's Law)
- **Eight built-in species presets**: Atlantic salmon, turbot, grouper, largemouth bass, mandarin fish, tilapia, eel, whiteleg shrimp (plus a custom-species mode)
- **Steady-state water-quality simulation** via exact recycle equations (TAN / TSS / DOM / NO₃ / DO / CO₂)
- **Hybrid mainline-series + bypass-parallel modeling** (protein skimmer / denitrification / AOP)
- **Salinity correction** (DO saturation + nitrification efficiency + seawater ozone bromate warning)
- **Equipment specification & selection** (drum filter / biofilter / UV / CO₂ stripper / protein skimmer / AOP / denitrification / oxygenation / pumps)
- **Parallel multi-module design with N+1 redundancy**
- **Automatic P&ID generation**
- **Equipment schedule export**

### Climate & thermal balance
- One-click switching across temperate / subtropical / Nordic / southern-China design conditions
- **Coupled air–water two-node steady-state solver** (building heat loss + fish metabolic heat + heat-exchanger recovery)
- Automatic heat-pump capacity estimation for representative site climates

### Investment & financial evaluation
- Full **NPV / IRR / payback / break-even** calculation
- **Eight standard financial tables** (revenue / cost / profit / cash flow / debt service / sensitivity, etc.)
- **Five-factor sensitivity analysis** (sale price / CAPEX / yield / feed / electricity)
- All costs in **EUR**
- **One-click Excel export** (SheetJS, multi-sheet workbook)

---

## Quick start

### Option 1 — Download
Download the source, then open `index.html` in your browser.

### Option 2 — Clone

```bash
git clone https://github.com/chengsunmail/iras-en.git
cd iras-en
# open index.html in your browser
```

### Requirements
- Any modern browser (Chrome / Edge / Firefox / Safari)
- **No installation, no backend, no account.** First load fetches a few libraries (Tailwind / nunjucks / docx.js / SheetJS) from CDN; afterwards it works offline.

---

## Documentation

**In-app help:** click the "? Help" button at the top right of the main page.

The engineering models — process principles and literature calibration, equipment design formulas and default parameters, climate-scenario cost baselines, the investment & financial evaluation methodology, the oxygen-cone mainline/bypass model, and the two-node thermal balance — are documented inline in the source as function-level technical notes, including the governing equations, coefficients, and literature references.

---

## When to use iRAS

**Good fit**
- Design firms: early-stage process concepts and cost estimates
- Owners / investors: rapid RAS feasibility screening
- Equipment suppliers / EPC: selection and option comparison
- Universities / researchers: RAS engineering teaching and coursework

**Not a substitute for**
- Formal environmental / safety / energy assessment (must be issued by accredited bodies)
- Detailed construction design — iRAS targets the concept-estimate stage (≈ ±40% accuracy)
- Dedicated financial software with Monte Carlo simulation — iRAS uses a single-point deterministic cash-flow model

---

## Citation

If you use iRAS in academic work, engineering reports, or commercial projects, please cite:

```
Sun, C. (2026). iRAS: A Platform for Recirculating Aquaculture System
Engineering Design (Version 1.7.0). https://github.com/chengsunmail/iras-en
```

BibTeX:

```bibtex
@software{iras2026,
  author    = {Sun, Cheng},
  title     = {iRAS: A Platform for Recirculating Aquaculture System Engineering Design},
  version   = {1.7.0},
  year      = {2026},
  url       = {https://github.com/chengsunmail/iras-en}
}
```

---

## Contributing

Issues and pull requests are welcome — bug reports, formula corrections, additional species presets, regional cost baselines, and translations are all useful. If you are reporting a modeling issue, please reference the relevant function-level technical note in the source where possible, so the discussion stays grounded in the documented physics.

---

## License

Released under the **GNU Affero General Public License v3 (AGPL v3)**.

**Note:** AGPL v3 requires that if you **offer iRAS — or a modified version — as a network service**, you must release the corresponding server-side source under the same license. See the [LICENSE](LICENSE) file for details.

---

## Author

**Cheng Sun** — water-treatment process engineer · Polarlys Innovation AS (Norway).

Developed with AI assistance. The physical models are calibrated against public literature and industry data (Timmons 2010; Sharrer 2010; Atlantic Sapphire public data; Linde SOLVOX; Pentair AES Speece, among others).

---

## Provenance

iRAS (English edition) v1.7.0 is the first public release of the English edition. It was initially ported from the original Chinese edition at version 1.7, which had reached that version through eight prior iterations covering steady-state concentration modeling, the physics framework and CAPEX/OPEX, global climate and two-node thermal balance, parallel multi-module design with P&ID, investment & financial evaluation, document export, site-level equipment, and the v1.7 oxygen-cone topology and system-discharge rework. From this release onward, the English edition is developed independently and will not track the Chinese edition's version line.

---

## Disclaimer

Results are for concept-estimate purposes only.

- Real projects must incorporate on-site water-quality monitoring, pilot data, local regulations, and professional engineering judgment.
- Investment estimates are approximate (≈ ±40%); actual cost depends on supplier quotes and tendering.
- iRAS does not replace formal environmental, safety, or energy assessments.
- System-discharge concentrations are reported at the **settling-tank inlet** (sludge-inclusive, mass-conserving) and should not be compared directly against pipe-outlet discharge standards.
- The author accepts no liability for engineering decisions made on the basis of this software's output.
