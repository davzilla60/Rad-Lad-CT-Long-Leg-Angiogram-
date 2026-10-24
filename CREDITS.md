# Credits

The simulated study is a **composite of two people**, joined at the level of L1/L2.

## 1. Chest → L1: KiTS-00026 (C4KC-KiTS)

**Adapted from:** KiTS-00026, arterial-phase series, C4KC-KiTS collection.

- Data citation: Heller N, Sathianathen N, Kalapara A, et al. (2019). *Data from C4KC-KiTS* [Data set].
  The Cancer Imaging Archive. https://doi.org/10.7937/TCIA.2019.IX49E8NX
- Licence: **Creative Commons Attribution 3.0 (CC BY 3.0)**: https://creativecommons.org/licenses/by/3.0/
  (read from the TCIA collection page on 2026-10-24). CC BY allows commercial use with attribution and an indication of changes.
- Scanner (DICOM header): Siemens SOMATOM Definition Flash, 5 mm slices at 2.5 mm spacing, 0.875 mm pixels.
- Like every KiTS case, this patient has a renal tumour (right kidney). It lies **below** the join, so it is not used.

## 2. L1 → toes: licensed stock footage

**Adapted from:** stock video of a CT lower-limb angiogram (Shutterstock; clips `shutterstock_1055220479` / `shutterstock_1055220482`
in the source folder), packaged as DICOM before this project (`leg_angiogram_ctseries_uncropped.dcm`; header: "derived from stock
video, NOT diagnostic"). Used under the site owner's Shutterstock licence.

## Changes made

1. **Composite.** The KiTS volume is scaled ×0.767 left–right, ×0.699 front–back and ×0.733 head–foot, so its outline matches the
   second patient at the join. The scanogram brightness of the KiTS part is ramped over the 80 mm above the join.
2. **Stock footage.** Duplicate video frames were dropped (591 → 387 unique), the CT table and burned-in overlay text were masked out, and
   the 8-bit grey levels were mapped to *approximate* HU with a two-point fit (fat → −100 HU, muscle → +50 HU). Saturated bone was
   stretched so it reads as bone. The footage is not calibrated: its pixel size (0.92 mm) and slice spacing (2.69 mm) are nominal.
3. **Scanograms** (`scout_ap`, `scout_lat`) are digitally reconstructed radiographs of the composite volume, not acquired localisers. They are teal-tinted to match the sibling sims.
4. **Axial images** are resampled every 8 mm onto a 376 px square grid and re-encoded as 8-bit JPEG with a piecewise HU mapping.
5. **Contrast enhancement is digitally altered.** Arteries were segmented by thresholding, slice tracking of the aorta and 3-D
   connectivity, then rescaled in the browser to a simplified contrast model, for the moment the table reached each slice. Noise is added.
   Other organs keep the enhancement they had in the source scans, so the "pre-contrast" monitoring slice is not truly unenhanced.
6. **Monitoring images, the timed-scan preview, time–density curves, HU read-outs, the run-off MIP and the grading** come from
   the model, not from measured data.

Neither the dataset authors nor their institutions endorse this simulator.

## Other artwork

- The patient-positioning scene (CT room, feet-first table movement, lasers, injector) is an original 3-D scene, built procedurally
  for this project in `room3d.js`. It uses no third-party models, photos or textures. A simpler original SVG drawing is the fallback.
- 3-D rendering uses [three.js](https://threejs.org) r160 (MIT licence, (c) three.js authors), loaded at runtime from jsDelivr.
- The Rad-Lad logo is the property of Rad-Lad.
