# The Scanogram — CT Angiogram Run-off (lower-limb "long leg" CTA)

An embeddable, single-file teaching simulator for the Rad-Lad website. Part of the
"Scanogram" family (circle of Willis, carotid, hand, knee, T-spine, CTPA, wrist). Marker: **Legs for Days**.

## Flow

1. **Patient set-up**: a real-time 3-D CT room (`room3d.js`, three.js from jsDelivr; it falls back to an SVG drawing). The patient lies supine, **feet first** so the whole run-off fits in the table travel, with the arms up and the legs together, feet strapped toes-up. `load` moves the table to the lasers (xiphisternum landmark), then to the start position.
2. **Scanogram**: AP and lateral localisers, from the lower chest to beyond the feet.
3. **Scan range**: drag the box on the AP scanogram (the lateral sits alongside at full height).
   Ideal: **diaphragm domes → beyond the tips of the toes**.
4. **Table speed + timing**: set the table speed (20–150 mm/s; the scan time for the prescribed range updates live), then choose:
   - **Bolus tracking** (`bt`): set the monitoring level on the aorta, place the ROI in the aortic lumen, choose the threshold, then `inject`.
     When the ROI crosses the threshold, monitoring continues through a 4 s breath-hold delay before the helical scan starts.
   - **Timed scan** (`timed`): choose a fixed delay (5–45 s) from the start of injection. A clearly labelled *simulated* aortic view and HU readout run during the countdown.
5. **Acquisition**: a live read-out of **table position vs bolus front**. It warns where the table overtakes the contrast.
6. **Review**: the axial stack is trimmed to the range, and **every slice is rendered for the moment the table reached it**:
   arterial HU = the aortic curve, delayed by the transit time down the legs. The review also has CTA / soft / bone windows,
   a **run-off MIP** (arteries scaled row by row to the enhancement achieved, bone dimmed), a mid-calf close-up and a % score.

Each run randomises the patient's circulation: arrival in the upper abdominal aorta varies by −3 … +4 s, and the bolus travels down
the legs at 55–120 mm/s. A fast table outruns a slow bolus, and a very slow table images the feet in the washout / venous phase.

## Contrast model

- 140 mL @ 4 mL/s (35 s) + saline. Aortic curve: arrival t0 = 14 s ± patient shift, ~4 s rise, plateau for the injection, then washout, plus recirculation.
- Arterial HU at depth z (mm from the top of the scanogram) = aorta(t − max(0, z − 190 mm) / v_bolus).
- A slice at z is scanned at t = scan start + (z − range top) / table speed (cranio-caudal).

## Scoring (100)

| Part | Points |
|---|---|
| Upper limit at the diaphragm (10 if it starts > 110 mm into the chest; 7 if it starts above the renal arteries) | 15 |
| Lower limit beyond the toes (7 if it stops in the feet / ankles) | 15 |
| Aorto-iliac enhancement (≥ 250 HU = 15, ≥ 200 = 10, ≥ 150 = 5) | 15 |
| Distal run-off, the lowest calf-artery HU (≥ 200 = 25, ≥ 150 = 15, ≥ 100 = 6; 0 if the calves are not in range) | 25 |
| Table speed 30–50 mm/s = 10, 25–60 = 5 | 10 |
| Bolus tracking: level on the aorta 6 · ROI in the aortic lumen (≥ 8 mm) 8 · threshold 100–180 HU with auto-trigger 6 | 20 |
| Timed scan: delay 18–24 s = 20, 15–27 s = 10 | 20 |

**100%** unlocks the **Legs for Days** Marker.

## Files

- `legs.html` is the source. Its `<script>` block is generated: edit `tools/script.js`, then run `python tools/splice.py` (which pulls the geometry and aortic ROI targets from `assets/calib.json`), then `python inline.py`.
- `legs.embed.html` / `index.html` are the self-contained builds (~3 MB, every image inlined).
- `assets/` holds:
  - `scout_ap` and `scout_lat` (DRRs)
  - `ax_000…157` (axial slices every 8 mm, HU-encoded JPEG)
  - `lb_000…157` (artery labels ×60)
  - `mip_base` / `mip_art` (coronal MIPs)
  - `calib.json` and the Rad-Lad logos
- `tools/gen_assets.py` rebuilds every image asset from the two source scans (paths at the top of the file).

## The imaging is a composite

The lower-limb source supplied for this sim (`D:\Prometheus\CT\CT Angiograms\Lower Limb\Patient 1`) is a **stock-video clip
packaged as DICOM**, not a patient volume. Its axial series is a clean, contrast-enhanced sweep from **L1 to the toes**:
591 video frames, 387 of them unique, 8-bit, tone-mapped, with no HU and no geometry. Because it starts at L1, it has **no diaphragm**.
The chest → L1 section therefore comes from a real arterial-phase CT, **KiTS-00026** (C4KC-KiTS, CC BY 3.0). That section is rescaled
so the body outline matches at the join (z = 216 mm) and the brightness is ramped over the last 80 mm of the scanogram. See [CREDITS.md](CREDITS.md).

## Embedding

```html
<iframe src="legs.embed.html" style="width:100%;max-width:1040px;height:1350px;border:0" title="CT angiogram run-off simulator"></iframe>
```

The page is responsive: it switches to a single column below 780 px (checked at 375 px). Canvas pixel access is used to render the CT images, so
open the page over http(s), or use the self-contained `legs.embed.html`. Do not open it as `file://` with separate assets.
