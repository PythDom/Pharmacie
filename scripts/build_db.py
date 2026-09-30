"""Build a compact medicine lookup table from the Belgian SAM v2 open-data export.

Source: https://www.vas.ehealth.fgov.be/websamcivics/samcivics/ (FAMHP / eHealth, public).
Output (in <out_dir>):
  meds.json  medicines (AMPP: GTIN + CNK)       {"v", "d", "cols", "rows": [[...], ...]}
  para.json  parapharmacy / non-medicinal (CNK)  same shape, loaded lazily by the app

Usage: python scripts/build_db.py <sam.zip> <out_dir> [version]
"""
import json
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date

EXP = "{urn:be:fgov:ehealth:samws:v2:export}"
COM = "{urn:be:fgov:ehealth:samws:v2:actual:common}"
CORE = "{urn:be:fgov:ehealth:samws:v2:core}"
REF = "{urn:be:fgov:ehealth:samws:v2:refdata}"
NM = "{urn:be:fgov:ehealth:samws:v2:nonmedicinal:common}"

TODAY = date.today().isoformat()
COLS = ["gtin", "cnk", "name", "pack", "atc", "leaflet", "rx", "active"]


def current(el, tag):
    """Return (data_element, is_current) for the most relevant <Data> child."""
    datas = el.findall(tag)
    if not datas:
        return None, False
    for d in datas:
        if d.get("from", "") <= TODAY and (not d.get("to") or d.get("to") >= TODAY):
            return d, True
    return max(datas, key=lambda d: d.get("from", "")), False


def fr(el, path, ns=CORE):
    """French text of a multilingual element, falling back to NL/EN."""
    node = el.find(path) if path else el
    if node is None:
        return ""
    for lang in ("Fr", "Nl", "En", "De"):
        t = node.find(ns + lang)
        if t is not None and t.text:
            return " ".join(t.text.split())
    return ""


def parse_amp(zf, name, rows):
    with zf.open(name) as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != EXP + "Amp":
                continue
            amp_data, _ = current(el, EXP + "Data")
            amp_name = fr(amp_data, COM + "Name") if amp_data is not None else ""
            for ampp in el.findall(EXP + "Ampp"):
                d, is_cur = current(ampp, EXP + "Data")
                if d is None:
                    continue
                gtin = (d.findtext(COM + "FMDProductCode") or "").strip()
                cnks = ampp.findall(EXP + "Dmpp")
                cnk = ""
                for dm in sorted(cnks, key=lambda x: x.get("deliveryEnvironment") != "P"):
                    if dm.get("codeType", "CNK") == "CNK":
                        cnk = dm.get("code", "")
                        break
                if not gtin and not cnk:
                    continue
                name_ = fr(d, COM + "PrescriptionNameFamhp") or fr(d, COM + "AbbreviatedName") or amp_name
                atc = d.find(EXP + "Atc")
                modus = d.find(EXP + "DeliveryModus")
                rx = 1 if modus is not None and modus.get("code", "").startswith("M") else 0
                rows.append([
                    gtin,
                    cnk,
                    name_,
                    fr(d, COM + "PackDisplayValue"),
                    atc.get("code", "") if atc is not None else "",
                    fr(d, COM + "LeafletLink"),
                    rx,
                    1 if is_cur else 0,
                ])
            el.clear()


def parse_nonmed(zf, name, rows):
    with zf.open(name) as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != EXP + "NonMedicinalProduct":
                continue
            d, is_cur = current(el, EXP + "Data")
            if d is not None and el.get("code"):
                rows.append(["", el.get("code"), fr(d, NM + "Name", ns=CORE), "", "", "", 0, 1 if is_cur else 0])
            el.clear()


def dedupe(rows):
    """Deduplicate on (gtin, cnk), preferring currently active rows."""
    best = {}
    for r in rows:
        key = (r[0], r[1])
        if key not in best or (r[7] and not best[key][7]):
            best[key] = r
    return sorted(best.values(), key=lambda r: r[2].lower())


def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    version = sys.argv[3] if len(sys.argv) > 3 else ""
    meds, para = [], []
    with zipfile.ZipFile(src) as zf:
        for n in zf.namelist():
            if n.startswith("AMP-"):
                parse_amp(zf, n, meds)
            elif n.startswith("NONMEDICINAL-"):
                parse_nonmed(zf, n, para)
    for name, rows in (("meds.json", dedupe(meds)), ("para.json", dedupe(para))):
        path = os.path.join(out_dir, name)
        with open(path, "w", encoding="utf-8") as f:
            # One row per line: readable git diffs, and the header line (version/date) can be ignored.
            dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
            f.write('{"v":%s,"d":%s,"cols":%s,"rows":[\n' % (dump(version), dump(TODAY), dump(COLS)))
            f.write(",\n".join(dump(r) for r in rows))
            f.write("\n]}\n")
        print(f"{name}: {len(rows)} rows, {sum(1 for r in rows if r[0])} with GTIN")


if __name__ == "__main__":
    main()
