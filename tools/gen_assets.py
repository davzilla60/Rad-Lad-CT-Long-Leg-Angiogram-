"""Build every image asset for the CT lower-limb run-off angiogram simulator ("Legs for Days").

The study is a COMPOSITE of two sources, joined at the level of L1/L2:

  1. Upper part (chest -> L1): KiTS-00026 arterial-phase CT (C4KC-KiTS, TCIA, CC BY 3.0), real HU.
     Scaled isotropically (KITS_SCALE) so the body width matches the leg patient at the join.
  2. Lower part (L1 -> toes): the stock-video "leg angiogram" CT sweep the user licensed
     (leg_angiogram_ctseries_uncropped.dcm, 591 video frames, 8-bit, tone-mapped - NOT HU).
     Duplicate video frames are dropped; the remaining 387 unique frames are assumed to be evenly
     spaced (checked against the stock coronal series: landmark proportions agree within ~2 %).
     Grey values are mapped to pseudo-HU with a two-point fit (fat 65 -> -100 HU, muscle 133 -> 50 HU).
     Geometry is nominal: 0.92 mm pixels, L1 -> toe tips = ~1040 mm.

Outputs (../assets/)
  scout_ap.jpg / scout_lat.jpg  - digitally reconstructed radiographs of the composite volume
  ax_NNN.jpg                    - axial slices every STEP mm, square IMG_W px, HU via HU_LUT
  lb_NNN.png                    - labels x60: 1 = artery (contrast follows the run-off model)
  mip_base.jpg / mip_art.png    - coronal MIPs (non-arterial / arterial, normalised) for the result
  calib.json                    - geometry, landmark fractions, aortic ROI targets
"""
import glob, json, os, sys
import numpy as np
import pydicom
from PIL import Image
from scipy import ndimage as ndi

STOCK = r"D:/Prometheus/CT/CT Angiograms/Lower Limb/Patient 1/DICOM/leg_angiogram_ctseries_uncropped.dcm"
KITS = r"D:/Prometheus/CT/Abdomen and Pelvis/Patient Group 10 (Kidney)/c4kc_kits/KiTS-00026/*/38134"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
PREVIEW = len(sys.argv) > 1 and sys.argv[1] == "--preview"

PX = 0.92                     # nominal stock pixel (mm)
STOCK_LEN = 1040.0            # nominal L1 -> toe tips (mm) over the unique frames
K_TOP, K_SEAM, K_DOME = 36, 154, 106       # KiTS slices: scanogram top (just below the apices) / join with the stock sweep
TAIL_MM = 45.0                # empty table below the toes
STEP = 8.0                    # mm between review slices
ZRES = 2.0                    # mm per scanogram row before resizing
HU_LUT = [(-1000, 0), (-300, 60), (600, 255)]
ART_REF = 300.0               # arterial lumen core HU after normalisation (both sources)
FAT_G, FAT_HU, MUS_G, MUS_HU = 65, -100.0, 133, 50.0


def hu_to_byte(h):
    (h0, b0), (h1, b1), (h2, b2) = HU_LUT
    out = np.where(h < h1, b0 + (h - h0) * (b1 - b0) / (h1 - h0), b1 + (h - h1) * (b2 - b1) / (h2 - h1))
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


# ------------------------------------------------------------------ stock sweep
def load_stock():
    a = pydicom.dcmread(STOCK).pixel_array
    d = np.abs(np.diff(a.astype(np.int16), axis=0)).mean((1, 2))
    keep = [0] + [i + 1 for i in range(len(d)) if d[i] >= 0.3]
    keep = [k for k in keep if a[k].max() > 100]
    # the clip loops back to the abdomen after the toes: stop at the first big jump in body area
    area = [(a[k] > 25).sum() for k in keep]
    for j in range(200, len(keep)):
        if area[j] > 4 * area[j - 1] + 5000:
            keep = keep[:j]
            break
    return a, keep


def stock_mask(f):
    m = f > 25
    m[272:] = False                                   # table centre + burned-in overlay text
    core = ndi.binary_opening(m, structure=np.ones((5, 5)))   # breaks the thin table arc off the body
    lab, n = ndi.label(core)
    keep = np.zeros_like(m)
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        c = lab[sl] == i
        h, w = c.shape
        if c.sum() < 80 or (h < 30 and w > 100) or f[sl][c].mean() > 185 or sl[0].start > 235:   # table arc / its end hooks
            continue
        keep[sl] |= c
    keep = ndi.binary_dilation(keep, iterations=3) & m
    return ndi.binary_fill_holes(keep)


def stock_hu(f, mask):
    g = f.astype(np.float32)
    slope = (MUS_HU - FAT_HU) / (MUS_G - FAT_G)
    hu = FAT_HU + (g - FAT_G) * slope
    g0 = 30.0
    hu0 = FAT_HU + (g0 - FAT_G) * slope
    hu = np.where(g < g0, -1000 + g * (hu0 + 1000) / g0, hu)
    return np.where(mask, hu, -1000.0)


def seg_stock(f, mask, region, spine_row=None):
    """Arteries on a stock frame: bright (>= 200), not part of a bone at the 160 level, away from the skin.
    region: 'trunk' (aorta allowed), 'leg' (small vessels only), 'foot' (tiny only).
    spine_row: drop candidates behind the vertebral body (spinous processes, facets) - lumbar frames only."""
    dist = ndi.distance_transform_edt(mask)
    lo_lab, _ = ndi.label(f >= 160)
    bad = set()
    for i, sl in enumerate(ndi.find_objects(lo_lab), 1):
        if sl is None:
            continue
        c = lo_lab[sl] == i
        a = c.sum()
        if a > 900 or ndi.binary_fill_holes(c).sum() > 1.15 * a or (a > 60 and a / c.size < 0.45):
            bad.add(i)
    cap = {"trunk": 900, "leg": 70, "foot": 10}[region]
    lab, n = ndi.label(f >= 200)
    art = np.zeros(f.shape, bool)
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        c = lab[sl] == i
        a = c.sum()
        if a < 3 or a > cap or (a > 40 and a / c.size < 0.3):     # arcs of cortex
            continue
        if a > 20 and ndi.binary_fill_holes(c).sum() > 1.15 * a:   # closed cortical rings
            continue
        parent = np.bincount(lo_lab[sl][c]).argmax()
        if parent in bad:
            continue
        cy, cx = ndi.center_of_mass(c)
        if dist[int(sl[0].start + cy), int(sl[1].start + cx)] < (20 if region == "trunk" else 14):      # ribs / skin
            continue
        if spine_row is not None and sl[0].start + cy > spine_row:
            continue
        art[sl] |= c
    return ndi.binary_dilation(art, iterations=1) & (f >= 150)


# ------------------------------------------------------------------ KiTS
def load_kits():
    fs = glob.glob(KITS + "/*.dcm")
    ds = [pydicom.dcmread(f) for f in fs]
    ds.sort(key=lambda d: -float(d.ImagePositionPatient[2]))
    v = np.stack([d.pixel_array * float(d.RescaleSlope) + float(d.RescaleIntercept) for d in ds]).astype(np.float32)
    px = float(ds[0].PixelSpacing[0])
    dz = abs(float(ds[0].ImagePositionPatient[2]) - float(ds[1].ImagePositionPatient[2]))
    return v, px, dz


def kits_body(sl):
    m = sl > -400
    lab, n = ndi.label(m)
    ar = ndi.sum(m, lab, range(1, n + 1))
    return ndi.binary_fill_holes(lab == 1 + int(np.argmax(ar)))


def refs(mask):
    """(posterior skin row, body centre column, width px, depth px) of an axial body mask"""
    rows = np.where(mask.any(1))[0]
    cols = np.where(mask.any(0))[0]
    return float(rows[-1]), (cols[0] + cols[-1]) / 2.0, float(cols[-1] - cols[0]), float(rows[-1] - rows[0])


def track_aorta(v, body, k0, k1, seed):
    """slice-by-slice aorta (HU > 170) from k0 upward to k1, seeded at (row, col) on k0"""
    out = {}
    cy, cx = seed
    for k in range(k0, k1 - 1, -1):
        m = (v[k] > 170) & body[k]
        lab, n = ndi.label(m)
        best, bd = None, 1e9
        for i, sl in enumerate(ndi.find_objects(lab), 1):
            c = lab[sl] == i
            a = c.sum()
            if not 120 < a < 1500:
                continue
            yy, xx = ndi.center_of_mass(c)
            yy += sl[0].start
            xx += sl[1].start
            dd = np.hypot(yy - cy, xx - cx)
            if dd < bd and dd < 18 and c.sum() / c.size > 0.45:
                best, bd = (i, yy, xx), dd
        if best is None:
            break
        i, cy, cx = best
        out[k] = lab == i
    return out


def seg_kits(sl, body, aorta, branches=True):
    """aorta (tracked) + small enhancing branches (abdomen only) away from bone and skin"""
    art = aorta.copy() if aorta is not None else np.zeros(sl.shape, bool)
    if not branches:
        return art
    bone = sl > 250
    lab, n = ndi.label(bone)
    ar = ndi.sum(bone, lab, range(1, n + 1))
    big = np.isin(lab, [i + 1 for i in range(n) if ar[i] > 150])
    if aorta is not None:
        big &= ~ndi.binary_dilation(aorta, iterations=2)
    near_bone = ndi.binary_dilation(big, iterations=6)
    if aorta is None:
        return art
    ay, ax = ndi.center_of_mass(aorta)
    dist = ndi.distance_transform_edt(body)
    lab2, n2 = ndi.label((sl > 190) & body)
    for i, s in enumerate(ndi.find_objects(lab2), 1):
        c = lab2[s] == i
        a = c.sum()
        if a < 4 or a > 90:
            continue
        cy, cx = ndi.center_of_mass(c)
        y, x = int(s[0].start + cy), int(s[1].start + cx)
        if near_bone[y, x] or dist[y, x] < 30 or np.hypot(y - ay, x - ax) > 50:
            continue
        art[s] |= c
    return art


def main():
    os.makedirs(OUT, exist_ok=True)
    for fn in glob.glob(os.path.join(OUT, "ax_*.jpg")) + glob.glob(os.path.join(OUT, "lb_*.png")):
        os.remove(fn)
    a, keep = load_stock()
    NS = len(keep)
    DZS = STOCK_LEN / NS
    print("stock unique frames", NS, "dz %.2f mm" % DZS)
    v, kpx, kdz = load_kits()
    kbody = np.stack([kits_body(s) for s in v])

    # ---- scale + alignment at the join
    f0 = a[keep[0]]
    m0 = stock_mask(f0)
    # anisotropic in-plane scale (width and depth matched separately at the join), mean scale along z
    s_rows, s_col, wS, dS = refs(m0)
    k_rows, k_col, wK, dK = refs(kbody[K_SEAM])
    SCX, SCY = wS * PX / (wK * kpx), dS * PX / (dK * kpx)
    SC = (SCX + SCY) / 2
    KDZ = kdz * SC
    print("KiTS scale x %.3f y %.3f z %.3f  (stock %.0f x %.0f mm, KiTS %.0f x %.0f mm)  KiTS slice -> %.2f mm"
          % (SCX, SCY, SC, wS * PX, dS * PX, wK * kpx, dK * kpx, KDZ))

    # ---- final square grid (stock pixels, cropped / padded)
    masks = [stock_mask(a[k]) for k in keep]
    union = np.any(masks, axis=0)
    cols = np.where(union.any(0))[0]
    rows = np.where(union.any(1))[0]
    c0, c1 = cols[0] - 10, cols[-1] + 10
    IMG_W = int(c1 - c0) // 2 * 2
    rmid = (rows[0] + rows[-1]) / 2
    r0 = int(round(rmid - IMG_W / 2))                 # grid row 0 = stock row r0 (may be negative)
    print("grid", IMG_W, "px  = %.0f mm FOV; stock rows %d..%d -> r0 %d" % (IMG_W * PX, rows[0], rows[-1], r0))

    def stock_to_grid(img, fill):
        out = np.full((IMG_W, IMG_W), fill, np.float32)
        for gr in range(IMG_W):
            sr = gr + r0
            if 0 <= sr < img.shape[0]:
                out[gr] = img[sr, c0:c0 + IMG_W]
        return out

    # grid pixel -> KiTS pixel (isotropic scale about the reference points)
    gy, gx = np.mgrid[0:IMG_W, 0:IMG_W].astype(np.float32)
    ky = (gy + r0 - s_rows) * PX / (kpx * SCY) + k_rows
    kx = (gx + c0 - s_col) * PX / (kpx * SCX) + k_col

    def kits_to_grid(sl, order=1, fill=-1000.0):
        return ndi.map_coordinates(sl, [ky, kx], order=order, cval=fill)

    # ---- composite z axis
    Z_SEAM = (K_SEAM - K_TOP) * KDZ
    Z_TOTAL = Z_SEAM + NS * DZS + TAIL_MM
    print("Z_SEAM %.0f mm  Z_TOTAL %.0f mm" % (Z_SEAM, Z_TOTAL))

    # aorta in KiTS: seed at the join slice, tracked upward
    lab, n = ndi.label((v[K_SEAM] > 170) & kbody[K_SEAM])
    best, bd = None, 1e9
    for i, s in enumerate(ndi.find_objects(lab), 1):
        c = lab[s] == i
        if not 150 < c.sum() < 1500 or c.sum() / c.size < 0.45:
            continue
        yy, xx = ndi.center_of_mass(c)
        yy += s[0].start; xx += s[1].start
        d = np.hypot(yy - (k_rows - 95 / kpx), xx - (k_col + 10 / kpx))   # ~ anterior-left of the vertebra
        if d < bd:
            best, bd = (yy, xx), d
    aorta = track_aorta(v, kbody, K_SEAM, K_TOP, best)
    print("KiTS aorta tracked over slices", min(aorta), "..", max(aorta))
    core = np.percentile(np.concatenate([v[k][aorta[k]] for k in aorta]), 60)
    print("KiTS aortic core HU %.0f" % core)

    # ---- per-source slices on the grid (HU float32, label bool)
    def kits_slice(k):
        hu = kits_to_grid(np.where(kbody[k], v[k], -1000.0))
        art = seg_kits(v[k], kbody[k], aorta.get(k), branches=k > K_DOME)
        lb = kits_to_grid(art.astype(np.float32), order=1, fill=0) > 0.5
        hu = np.where(lb, 40 + (hu - 40) * (ART_REF - 40) / (core - 40), hu)
        return hu, lb

    # stock arteries: per-frame candidates, then keep only 3-D components that run >= 5 frames (~13 mm)
    cand = np.zeros((NS,) + a.shape[1:], bool)
    for j in range(NS):
        fr = a[keep[j]]
        region = "trunk" if j < 130 else ("leg" if j < 345 else "foot")
        spine = None
        if j < 60:
            bl, bn = ndi.label((fr >= 200) & masks[j])
            if bn:
                ar = ndi.sum(fr >= 200, bl, range(1, bn + 1))
                big = int(np.argmax(ar)) + 1
                spine = ndi.center_of_mass(bl == big)[0] - 12
        cand[j] = seg_stock(fr, masks[j], region, spine)
    # abdominal aorta (stock frames): saturated round blob tracked from the join to the bifurcation;
    # it touches the vertebra at the 160 level, so the bone-parent test above can reject it
    prev, miss = None, 0
    for j in range(0, 70):
        fr = a[keep[j]]
        bright = (fr >= 215) & masks[j]
        lab, n = ndi.label(bright)
        if prev is not None:
            # where the aorta abuts the vertebra the two merge: split them with an opening
            pl = lab[int(prev[0]), int(prev[1])]
            if pl and (lab == pl).sum() > 1500:
                lab, n = ndi.label(ndi.binary_opening(bright, iterations=3))
        best, bd = None, 1e9
        for i, sl in enumerate(ndi.find_objects(lab), 1):
            c = lab[sl] == i
            ar = c.sum()
            if not 120 < ar < 1500 or ar / c.size < 0.5:
                continue
            yy, xx = ndi.center_of_mass(c)
            yy += sl[0].start; xx += sl[1].start
            if prev is None:
                d = abs(xx - (fr.shape[1] / 2 + 10)) + (0 if ar > 250 else 200)
            else:
                d = np.hypot(yy - prev[0], xx - prev[1])
                if d > 14:
                    continue
            if d < bd:
                best, bd = (i, yy, xx), d
        if best is None:
            miss += 1
            if miss > 3:
                print("stock aorta tracked to frame", j - miss, "(bifurcation)")
                break
            continue
        miss = 0
        prev = best[1:]
        cand[j] |= ndi.binary_dilation(lab == best[0], iterations=1) & (fr >= 150)
    lab3, n3 = ndi.label(cand, structure=np.ones((3, 3, 3)))
    ext = [sl[0].stop - sl[0].start for sl in ndi.find_objects(lab3)]
    good = np.zeros(n3 + 1, bool)
    good[1:] = np.array(ext) >= 5
    cand = good[lab3]
    del lab3
    print("stock artery components kept", int(good.sum()), "of", n3)

    def stock_slice(j):
        fr = a[keep[j]]
        mk = masks[j]
        hu = stock_hu(fr, mk)
        lb = cand[j]
        # bone saturates at 255 in the video: stretch non-arterial bright pixels so bone reads as bone
        g = fr.astype(np.float32)
        h190 = FAT_HU + (190 - FAT_G) * (MUS_HU - FAT_HU) / (MUS_G - FAT_G)
        hu = np.where(~lb & mk & (g > 190), h190 + (g - 190) * (1100 - h190) / 65, hu)
        # stock contrast saturates at 255 (321 pseudo-HU): treat that as the lumen core
        sat = FAT_HU + (255 - FAT_G) * (MUS_HU - FAT_HU) / (MUS_G - FAT_G)
        hu = np.where(lb, 40 + (hu - 40) * (ART_REF - 40) / (sat - 40), hu)
        return stock_to_grid(hu, -1000.0), stock_to_grid(lb.astype(np.float32), 0) > 0.5

    cacheK, cacheS = {}, {}

    def slice_at(z):
        """linear blend between neighbouring source slices at composite depth z (mm)"""
        if z < Z_SEAM:
            fk = K_TOP + z / KDZ
            k = int(np.floor(fk)); t = fk - k
            k2 = min(k + 1, K_SEAM - 1)
            for kk in (k, k2):
                if kk not in cacheK:
                    cacheK[kk] = kits_slice(kk)
            (h1, l1), (h2, l2) = cacheK[k], cacheK[k2]
        else:
            fj = (z - Z_SEAM) / DZS
            if fj > NS - 1:
                return np.full((IMG_W, IMG_W), -1000.0, np.float32), np.zeros((IMG_W, IMG_W), bool)
            j = int(np.floor(fj)); t = fj - j
            j2 = min(j + 1, NS - 1)
            for jj in (j, j2):
                if jj not in cacheS:
                    cacheS[jj] = stock_slice(jj)
            (h1, l1), (h2, l2) = cacheS[j], cacheS[j2]
        return h1 * (1 - t) + h2 * t, (l1 if t < 0.5 else l2)

    # ---- scanogram rows + MIPs (every ZRES mm)
    zs = np.arange(0, Z_TOTAL, ZRES)
    AP = np.zeros((len(zs), IMG_W), np.float32)
    LAT = np.zeros((len(zs), IMG_W), np.float32)
    MB = np.zeros((len(zs), IMG_W), np.float32)
    MA = np.zeros((len(zs), IMG_W), np.float32)
    for i, z in enumerate(zs):
        hu, lb = slice_at(z)
        mu = np.clip(hu + 1000, 0, 2800) / 1000.0
        AP[i] = mu.sum(0) * PX
        LAT[i] = mu.sum(1) * PX
        MB[i] = np.where(lb, -1000, hu).max(0)
        MA[i] = np.where(lb, hu, -1000).max(0)
        if len(cacheS) > 6:
            for kk in sorted(cacheS)[:-3]:
                cacheS.pop(kk)
        if len(cacheK) > 6:
            for kk in sorted(cacheK)[:-3]:
                cacheK.pop(kk)
    # cosmetic: the two patients differ slightly in overall attenuation - ramp the KiTS rows over the
    # 80 mm above the join so the scanogram has no brightness step there
    iz = int(Z_SEAM / ZRES)
    for P in (AP, LAT):
        body = P > 30
        above = P[iz - 4:iz][body[iz - 4:iz]].mean()
        below = P[iz:iz + 4][body[iz:iz + 4]].mean()
        ramp = np.clip(1 - (iz - np.arange(iz)) / (80 / ZRES), 0, 1)
        P[:iz] *= (1 + (below / above - 1) * ramp)[:, None]
    H = int(round(Z_TOTAL))                     # 1 mm per output row
    Wmm = IMG_W * PX

    def drr(p, flip=False):
        p = np.log1p(p / 40.0)
        lo, hi = np.percentile(p, 30), np.percentile(p, 99.85)
        p = np.clip((p - lo) / (hi - lo), 0, 1) ** 1.6
        g = Image.fromarray((p * 255).astype(np.uint8)).resize((int(round(Wmm)), H), Image.LANCZOS)
        if flip:
            g = g.transpose(Image.FLIP_LEFT_RIGHT)
        g = np.asarray(g, np.float32) / 255
        return Image.fromarray((np.stack([g * .78, g * .97, g * .95], -1) * 255).astype(np.uint8))

    drr(AP, flip=True).save(os.path.join(OUT, "scout_ap.jpg"), quality=88)   # radiological convention: patient right on viewer left
    drr(LAT).save(os.path.join(OUT, "scout_lat.jpg"), quality=88)            # anterior to the left
    mb = np.clip((MB + 100) / 1300, 0, 1)
    Image.fromarray((mb * 255).astype(np.uint8)).resize((int(round(Wmm)), H), Image.LANCZOS).transpose(Image.FLIP_LEFT_RIGHT) \
        .save(os.path.join(OUT, "mip_base.jpg"), quality=88)
    ma = np.clip((MA - 40) / (ART_REF - 40), 0, 1)
    Image.fromarray((ma * 255).astype(np.uint8)).resize((int(round(Wmm)), H), Image.BILINEAR).transpose(Image.FLIP_LEFT_RIGHT) \
        .save(os.path.join(OUT, "mip_art.png"))

    # ---- review stack
    AX_N = int(np.floor((Z_TOTAL - TAIL_MM) / STEP)) + 1
    targets = {}
    for k in range(AX_N):
        z = k * STEP
        hu, lb = slice_at(z)
        Image.fromarray(hu_to_byte(hu)).save(os.path.join(OUT, "ax_%03d.jpg" % k), quality=90)
        Image.fromarray((lb * 60).astype(np.uint8)).save(os.path.join(OUT, "lb_%03d.png" % k), optimize=True)
        # aortic / iliac ROI target: largest round arterial blob of >= 12 mm
        lab, n = ndi.label(lb)
        if n:
            ar = ndi.sum(lb, lab, range(1, n + 1))
            i = int(np.argmax(ar))
            if ar[i] * PX * PX >= np.pi * 6 ** 2:
                cy, cx = ndi.center_of_mass(lab == i + 1)
                r = np.sqrt(ar[i] / np.pi)
                targets[k] = {"x": round(cx / IMG_W, 4), "y": round(cy / IMG_W, 4), "r": round(r / IMG_W, 4)}
        if PREVIEW and k % 4 == 0:
            print("slice", k, "z", z, "art px", int(lb.sum()))
    json.dump({
        "IMG_W": IMG_W, "FOV_MM": round(IMG_W * PX, 1), "Z_TOTAL": round(Z_TOTAL, 1), "Z_SEAM": round(Z_SEAM, 1),
        "AX_N": AX_N, "STEP": STEP, "KITS_SCALE": [round(SCX, 3), round(SCY, 3), round(SC, 3)], "KITS_SLICE_MM": round(KDZ, 3),
        "STOCK_FRAMES": NS, "STOCK_DZ": round(DZS, 3), "ART_REF": ART_REF, "KITS_AORTA_CORE": round(float(core), 1),
        "TARGETS": targets,
    }, open(os.path.join(OUT, "calib.json"), "w"), indent=1)
    print("wrote", AX_N, "review slices")


if __name__ == "__main__":
    main()
