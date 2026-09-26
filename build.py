#!/usr/bin/env python3
"""Build the static data for the EHR exploded-view archive.

Reads synthetic_hospital/benchmark_v1.3.db + patient_profiles.jsonl and writes
  site/data/hospital.json          one light entry per patient + diagnosis index
  site/data/patients/<id>.json     everything linked to one patient (lazy-loaded)

Run with the local venv (needs simple_icd_10_cm for the ICD-10 chapter/block tree):
  .venv/bin/python build.py
"""
import json
import os
import re
import sqlite3
from collections import defaultdict, Counter

import simple_icd_10_cm as icd

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "synthetic_hospital")
OUT = os.path.join(ROOT, "site", "data")
os.makedirs(os.path.join(OUT, "patients"), exist_ok=True)

db = sqlite3.connect(os.path.join(SRC, "benchmark_v1.3.db"))
db.row_factory = sqlite3.Row
q = lambda sql, *a: db.execute(sql, a).fetchall()

# ---------------------------------------------------------------- ICD-10 tree
# Short wing names for the 22 ICD-10-CM chapters (the chapter titles are long).
CHAPTER_SHORT = {
    1: "Infectious", 2: "Neoplasms", 3: "Blood & Immune", 4: "Endocrine & Metabolic",
    5: "Mental & Behavioral", 6: "Nervous System", 7: "Eye", 8: "Ear",
    9: "Circulatory", 10: "Respiratory", 11: "Digestive", 12: "Skin",
    13: "Musculoskeletal", 14: "Genitourinary", 15: "Pregnancy & Childbirth",
    16: "Perinatal", 17: "Congenital", 18: "Symptoms & Signs",
    19: "Injury & Poisoning", 20: "External Causes", 21: "Health Status (Z)",
    22: "Special Purpose",
}
ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII",
         "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII"]


def icd_path(code):
    """Return (chapter_no, chapter_desc, block_code, block_desc) or None."""
    if not code:
        return None
    c = code.strip().upper()
    tries = [c]
    # fall back to shorter parents when a code has an invalid extension
    base = c.replace(".", "")
    for n in range(len(base) - 1, 2, -1):
        tries.append(base[:3] + ("." + base[3:n] if n > 3 else ""))
    tries.append(base[:3])
    for t in tries:
        try:
            if icd.is_valid_item(t):
                anc = icd.get_ancestors(t)
                ch = anc[-1]
                # the block is the level directly under the chapter (usually "A00-A09", sometimes "O09")
                blk = anc[-2] if len(anc) >= 2 else t
                return (int(ch), icd.get_description(ch), blk,
                        icd.get_description(blk) if blk else "")
        except Exception:
            pass
    return None


# ---------------------------------------------------------------- lookups
dx_rows = {r["diagnosis_id"]: dict(r) for r in q("select * from diagnoses")}
finding_rows = {r["finding_id"]: dict(r) for r in q("select * from clinical_findings")}

qdx = defaultdict(list)
for r in q("select question_id, diagnosis_id, role from question_diagnoses where role!='distractor'"):
    qdx[r["question_id"]].append((r["diagnosis_id"], r["role"]))

qfind = defaultdict(list)
for r in q("select * from question_findings"):
    qfind[r["question_id"]].append(dict(r))

dxf = defaultdict(list)   # diagnosis_id -> [(finding_id, relationship, frequency)]
for r in q("select diagnosis_id, finding_id, relationship, frequency from diagnosis_findings"):
    dxf[r["diagnosis_id"]].append((r["finding_id"], r["relationship"], r["frequency"]))
dxf_map = {d: {f: (rel, fr) for f, rel, fr in v} for d, v in dxf.items()}

gt = defaultdict(dict)
for r in q("select patient_id, task, encounter_id, ground_truth from benchmark_ground_truth"):
    if r["task"] == "patient_diagnosis":
        gt[r["patient_id"]]["dx"] = json.loads(r["ground_truth"])

orders_by_enc = defaultdict(list)
for r in q("select * from imaging_orders"):
    orders_by_enc[r["encounter_id"]].append(dict(r))

sections_by_enc = defaultdict(list)
for r in q("select id, encounter_id, section_type, section_text, section_order, is_modified "
           "from encounter_ehr_sections order by encounter_id, section_order"):
    sections_by_enc[r["encounter_id"]].append(dict(r))

profiles = {}
with open(os.path.join(SRC, "patient_profiles.jsonl")) as fh:
    for line in fh:
        d = json.loads(line)
        profiles[d["patient_id"]] = json.loads(d["profile"]) if isinstance(d["profile"], str) else d["profile"]

# ---------------------------------------------------------------- helpers
SENT = re.compile(r"(?<=[.;])\s+(?=[A-Z0-9(])")


def split_lines(text):
    """A document's printed lines: hard newlines, then sentences for prose."""
    out = []
    for raw in (text or "").split("\n"):
        raw = raw.rstrip()
        if not raw.strip():
            out.append("")
            continue
        if len(raw) > 90 and not raw.lstrip().startswith("-"):
            out.extend(s.strip() for s in SENT.split(raw) if s.strip())
        else:
            out.append(raw)
    while out and out[-1] == "":
        out.pop()
    while out and out[0] == "":
        out.pop(0)
    return out


CANDIDATES = {
    "symptom": ["hpi", "chief_complaint", "ros"],
    "sign": ["physical_exam", "vitals", "hpi"],
    "vital_sign": ["vitals", "physical_exam", "hpi"],
    "lab_value": ["labs", "other_studies", "pathology"],
    "imaging_finding": ["imaging", "other_studies"],
    "procedure_result": ["other_studies", "imaging", "labs", "pathology", "physical_exam"],
    "medication": ["medications", "hpi"],
    "history_item": ["pmh", "psh", "social_history", "family_history", "hpi", "medications"],
    "demographic": ["hpi", "chief_complaint"],
}
STOP = set("with without from that this have been were into their there which about after before "
           "during history patient normal level serum total count present".split())


def tokens(s):
    return {w[:6] for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(w) >= 4 and w not in STOP}


def place_finding(f, secs):
    """Find the document + printed line a finding was abstracted from."""
    order = CANDIDATES.get(f["finding_type"], [])
    ranked = sorted(secs, key=lambda s: order.index(s["type"]) if s["type"] in order else 99)
    val = (f.get("value_text") or "").lower().strip()
    name = (f.get("display_name") or "").lower()
    toks = tokens(f.get("display_name")) | tokens(f.get("snomed_desc")) | tokens(f.get("loinc_desc"))
    best = (0, None, None)
    for rank, s in enumerate(ranked):
        bonus = 0.6 if s["type"] in order else 0.0
        for li, line in enumerate(s["lines"]):
            L = line.lower()
            sc = 0.0
            if val and len(val) >= 3 and val in L:
                sc += 3
            if name and name in L:
                sc += 3
            if toks:
                sc += 2.0 * len(toks & tokens(line)) / len(toks)
            if sc > 0:
                sc += bonus - rank * 0.01
            if sc > best[0]:
                best = (sc, s["sid"], li)
    if best[0] >= 1.5:
        return best[1], best[2]
    # section-level fallback: the document type the finding belongs to, if present
    for s in ranked:
        if s["type"] in order:
            return s["sid"], None
    return None, None


def norm(s):
    return re.sub(r"[^a-z0-9 ]", " ", (s or "").lower()).strip()


# ---------------------------------------------------------------- build
hospital_patients = []
dx_index = {}      # dx key -> {code,name,patients:[]}
stats = Counter()
chapters = {}      # chapter_no -> {..., blocks:{code:desc}}

pat_rows = q("select * from longitudinal_patients order by patient_id")
for p in pat_rows:
    pid = p["patient_id"]
    encs = [dict(r) for r in q("select * from longitudinal_encounters where patient_id=? order by encounter_date, encounter_order", pid)]
    g = gt[pid].get("dx", {})
    enc_ids = [e["encounter_id"] for e in encs]

    # --- problem list (patient level) -------------------------------------
    problems = {}

    def add_problem(did, kind, first_enc=None):
        d = dx_rows.get(did)
        if not d:
            return None
        if did not in problems:
            problems[did] = {
                "did": did, "code": d["icd10_code"], "name": d["display_name"],
                "icd_desc": d["icd10_desc"], "snomed": d["snomed_id"], "snomed_desc": d["snomed_desc"],
                "category": d["category"], "acuity": d["acuity"], "kind": kind,
                "first_enc": first_enc, "docs": {},
            }
        return problems[did]

    for item in g.get("active_diagnoses", []):
        add_problem(item["diagnosis_id"], "active", item.get("first_encounter_id"))
    for item in g.get("chronic_conditions", []):
        add_problem(item["diagnosis_id"], "chronic", item.get("first_encounter_id"))
    for eid, lst in g.get("encounter_diagnosis_map", {}).items():
        for it in lst:
            pr = add_problem(it["diagnosis_id"], "active", int(eid))
            if pr:
                pr["docs"][int(eid)] = "encounter diagnosis"

    enc_out = []
    findings_out = []
    for e in encs:
        eid = e["encounter_id"]
        qids = json.loads(e["source_question_ids"] or "[]")
        # secondary diagnoses documented at this visit
        for qid in qids:
            for did, role in qdx[qid]:
                if role == "correct":
                    pr = add_problem(did, "active", eid)
                    if pr:
                        pr["docs"].setdefault(eid, "encounter diagnosis")
                elif role == "secondary":
                    pr = add_problem(did, "secondary", eid)
                    if pr:
                        pr["docs"].setdefault(eid, "secondary diagnosis")

        secs = []
        for s in sections_by_enc[eid]:
            secs.append({"sid": s["id"], "type": s["section_type"], "order": s["section_order"],
                         "lines": split_lines(s["section_text"]), "mod": s["is_modified"]})
        e["_secs"] = secs
        e["_qids"] = qids
        enc_out.append(e)

    # problem-list mentions in later notes (chronic conditions carried forward)
    date_of = {e["encounter_id"]: e["encounter_date"] for e in enc_out}
    for e in enc_out:
        text = " ".join(" ".join(s["lines"]) for s in e["_secs"] if s["type"] in ("pmh", "assessment", "plan", "hpi"))
        nt = " " + norm(text) + " "
        for pr in problems.values():
            if e["encounter_id"] in pr["docs"]:
                continue
            # the synthetic notes carry the full problem list backwards in time; only count a
            # mention on/after the visit where the diagnosis was first documented
            first = min([date_of[k] for k in pr["docs"]] + ([date_of[pr["first_enc"]]] if pr["first_enc"] in date_of else []), default="0")
            if e["encounter_date"] < first:
                continue
            for cand in (pr["name"], pr["snomed_desc"]):
                c = norm(cand)
                if len(c) >= 6 and (" " + c + " ") in nt:
                    pr["docs"][e["encounter_id"]] = "problem list mention"
                    break

    # findings, placed on their source document + line, linked to diagnoses
    fidx = 0
    for e in enc_out:
        eid = e["encounter_id"]
        documented = {did for did, pr in problems.items() if eid in pr["docs"]}
        seen = set()
        for qid in e["_qids"]:
            for qf in qfind[qid]:
                cf = finding_rows.get(qf["finding_id"])
                if not cf or qf["finding_id"] in seen:
                    continue
                seen.add(qf["finding_id"])
                f = {**cf, "value_text": qf["value_text"], "value_numeric": qf["value_numeric"],
                     "present": qf["present"], "relevance": qf["relevance"]}
                if cf["finding_type"] == "demographic":
                    stats["demographic_findings_to_face_sheet"] += 1
                    continue
                sid, line = place_finding(f, e["_secs"])
                stats["findings_total"] += 1
                if sid is None:
                    stats["findings_unplaced"] += 1
                elif line is None:
                    stats["findings_section_only"] += 1
                links = []
                for did in documented:
                    rel = dxf_map.get(did, {}).get(qf["finding_id"])
                    if rel:
                        links.append({"did": did, "rel": rel[0], "freq": rel[1]})
                if links:
                    stats["findings_linked"] += 1
                findings_out.append({
                    "i": fidx, "fid": qf["finding_id"], "enc": eid, "sid": sid, "line": line,
                    "name": cf["display_name"], "type": cf["finding_type"],
                    "snomed": cf["snomed_id"], "snomed_desc": cf["snomed_desc"],
                    "loinc": cf["loinc_code"], "loinc_desc": cf["loinc_desc"],
                    "normal": cf["normal_range"], "value": qf["value_text"], "num": qf["value_numeric"],
                    "present": qf["present"], "relevance": qf["relevance"], "links": links,
                })
                fidx += 1

    # --- ICD filing: primary diagnosis ------------------------------------
    plist = list(problems.values())
    for pr in plist:
        pr["path"] = icd_path(pr["code"])

    def primary_key(pr):
        ch = pr["path"][0] if pr["path"] else 99
        disease = 0 if ch not in (18, 21, 22) else 1          # prefer disease chapters over R/Z/U
        core = 0 if pr["kind"] in ("active", "chronic") else 1
        first = next((e["encounter_date"] for e in enc_out if e["encounter_id"] == pr["first_enc"]), "9999")
        return (disease, core, -len(pr["docs"]), first)

    ranked = sorted([pr for pr in plist if pr["path"]], key=primary_key)
    prim = ranked[0] if ranked else None
    if prim is None:
        stats["no_icd_primary"] += 1
    ch_no, ch_desc, blk, blk_desc = prim["path"] if prim else (22, "Unclassified", "U00-U85", "Unclassified")
    chap = chapters.setdefault(ch_no, {"no": ch_no, "roman": ROMAN[ch_no], "name": CHAPTER_SHORT[ch_no],
                                       "title": ch_desc, "blocks": {}})
    chap["blocks"][blk] = blk_desc

    # --- per-patient file -------------------------------------------------
    prof = profiles.get(pid, json.loads(p["profile"]) if p["profile"] else {})
    enc_json = []
    for e in enc_out:
        eid = e["encounter_id"]
        orders = []
        img_sid = next((s["sid"] for s in e["_secs"] if s["type"] == "imaging"), None)
        for o in orders_by_enc.get(eid, []):
            orders.append({"order_id": o["order_id"], "modality": o["modality"], "region": o["body_region"],
                           "indication": o["clinical_indication"], "provider": o["ordering_provider"],
                           "priority": o["order_priority"], "datetime": o["order_datetime"], "result_sid": img_sid})
        enc_json.append({
            "id": eid, "date": e["encounter_date"], "type": e["encounter_type"], "dept": e["department"],
            "attending": e["attending_name"], "cc": e["chief_complaint"], "order": e["encounter_order"],
            "method": e["generation_method"], "question_ids": e["_qids"],
            "sections": [{"sid": s["sid"], "type": s["type"], "lines": s["lines"]} for s in e["_secs"]],
            "orders": orders,
        })
    problems_json = []
    for pr in sorted(plist, key=lambda x: (x["kind"] == "secondary", min((ee["date"] for ee in enc_json if ee["id"] in x["docs"]), default="9"))):
        problems_json.append({
            "did": pr["did"], "code": pr["code"], "name": pr["name"], "icd_desc": pr["icd_desc"],
            "snomed": pr["snomed"], "snomed_desc": pr["snomed_desc"], "category": pr["category"],
            "acuity": pr["acuity"], "kind": pr["kind"], "first_enc": pr["first_enc"],
            "chapter": pr["path"][0] if pr["path"] else None, "block": pr["path"][2] if pr["path"] else None,
            "docs": [{"enc": k, "how": v} for k, v in sorted(pr["docs"].items(), key=lambda kv: enc_ids.index(kv[0]))],
            "primary": prim is not None and pr["did"] == prim["did"],
        })
    patient = {
        "id": pid, "age": p["age"], "sex": p["sex"], "race": p["race_ethnicity"], "insurance": p["insurance"],
        "profile": prof, "comorbidities_listed": json.loads(p["comorbidities"] or "[]"),
        "primary": {"did": prim["did"], "code": prim["code"], "name": prim["name"]} if prim else None,
        "filing": {"chapter": ch_no, "block": blk, "block_desc": blk_desc},
        "encounters": enc_json, "problems": problems_json, "findings": findings_out,
    }
    with open(os.path.join(OUT, "patients", f"{pid}.json"), "w") as fh:
        json.dump(patient, fh, separators=(",", ":"))

    # --- hospital entry ---------------------------------------------------
    dates = [e["encounter_date"] for e in enc_out]
    ndocs = sum(len(e["_secs"]) for e in enc_out)
    dx_list = []
    for pr in problems_json:
        key = pr["code"] or ("uncoded:" + pr["name"])      # a few diagnoses carry no ICD-10 code
        ent = dx_index.setdefault(key, {"code": pr["code"] or "", "name": pr["name"], "names": set(), "patients": []})
        ent["names"].add(pr["name"])
        if pid not in ent["patients"]:
            ent["patients"].append(pid)
        dx_list.append([pr["code"] or "", pr["name"]])
    hospital_patients.append({
        "id": pid, "age": p["age"], "sex": p["sex"], "n": len(enc_out), "docs": ndocs,
        "span": [min(dates), max(dates)] if dates else None, "dx": dx_list,
        "ch": ch_no, "blk": blk, "pcode": prim["code"] if prim else None, "pname": prim["name"] if prim else None,
    })
    stats["patients"] += 1
    stats["encounters"] += len(enc_out)
    stats["documents"] += ndocs
    stats["problems"] += len(problems_json)
    stats["imaging_orders"] += sum(len(e["orders"]) for e in enc_json)

# ---------------------------------------------------------------- hospital.json
chap_list = []
for no in sorted(chapters):
    c = chapters[no]
    blocks = sorted(c["blocks"].items())
    chap_list.append({"no": no, "roman": c["roman"], "name": c["name"], "title": c["title"],
                      "blocks": [{"code": k, "desc": v} for k, v in blocks]})

index = []
for k, v in sorted(dx_index.items(), key=lambda kv: -len(kv[1]["patients"])):
    index.append({"code": v["code"], "name": v["name"], "alt": sorted(v["names"] - {v["name"]}),
                  "patients": v["patients"]})

hospital = {
    "source": "sparkcpark/synthetic_hospital benchmark_v1.3 (fully synthetic)",
    "totals": {"patients": stats["patients"], "encounters": stats["encounters"], "documents": stats["documents"],
               "problems": stats["problems"], "imaging_orders": stats["imaging_orders"]},
    "chapters": chap_list,
    "patients": hospital_patients,
    "index": index,
}
with open(os.path.join(OUT, "hospital.json"), "w") as fh:
    json.dump(hospital, fh, separators=(",", ":"))

print(json.dumps(dict(stats), indent=1))
print("chapters:", [(c["roman"], c["name"], sum(1 for p in hospital_patients if p["ch"] == c["no"]), len(c["blocks"])) for c in chap_list])
print("hospital.json bytes:", os.path.getsize(os.path.join(OUT, "hospital.json")))
