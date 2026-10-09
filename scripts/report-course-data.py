"""Verify downloaded data and publish separate current/historical/plan exports.

This report measures available sources, not complete or current curricula.
It performs no database import, deployment or authentication.
"""
import hashlib
import json
import re
import runpy
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "course-data"


def read(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))


def write(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalized_program(name):
    aliases = {"土木国际": "土木工程", "材料国际": "材料科学与工程", "城市地下空间专业": "城市地下空间工程"}
    if name in aliases:
        return aliases[name], "special" if "国际" in name else "ordinary"
    special = bool(re.search(r"强基|拔尖|卓越|高水平|国际|中外", name))
    name = re.sub(r"[（(].*[）)]", "", name)
    name = re.sub(r"(?:专业)?(?:卓越|拔尖)人才培养.*$", "", name)
    return name, "special" if special else "ordinary"


def main():
    manifest = read("manifest.json")
    sources = {x["id"]: x for x in manifest}
    rows = read("course-records.json")
    candidates = read("catalog-candidates.json")["courses"]
    errors = []
    for source in manifest:
        if source.get("status") != "downloaded":
            continue
        path = ROOT / source["local_file"]
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]:
            errors.append({"source_id": source["id"], "issue": "checksum_mismatch_or_missing"})
    for row in rows:
        if row["source_id"] not in sources or not row.get("name") or not row.get("locator"):
            errors.append({"source_id": row.get("source_id"), "issue": "missing_provenance"})
    current = [x for x in rows if x["source_kind"] == "public_elective_list"]
    historical = [x for x in rows if x["source_kind"] == "public_elective_syllabus"]
    plans = [x for x in rows if x["source_kind"] == "undergraduate_plan"]
    # Independent control totals printed in the 2026 official notice.
    if len(current) != 18 or Counter(x["platform"] for x in current) != {"超星": 12, "智慧树": 6}:
        errors.append({"issue": "current_elective_notice_control_total"})
    if sum(x["origin_university"] == "中南大学" for x in current) != 5:
        errors.append({"issue": "current_elective_origin_control_total"})
    helper = runpy.run_path(str(ROOT / "scripts" / "extract-course-data.py"))
    paragraphs = helper["paragraphs_docx"](ROOT / sources["public-electives-2016"]["local_file"])
    toc = []
    for paragraph in paragraphs[10:230]:
        match = re.fullmatch(r"(.+?)(\d+)\s*", paragraph)
        if match:
            toc.append(helper["course_name"](match[1]))
    missing_toc = sorted(set(toc) - {x["name"] for x in historical})
    if len(toc) != 216 or missing_toc:
        errors.append({"issue": "historical_elective_toc", "missing": missing_toc, "toc_count": len(toc)})
    write("public-electives-current.json", {"term": "2026-2027-1", "scope": "网上MOOC全校性选修课程；不含完整线下公选课名单", "courses": current})
    write("public-electives-historical.json", {"edition": 2016, "current_term_confirmed": False, "courses": historical})
    write("curriculum-course-records.json", {"complete_curricula_verified": False, "records": plans})

    official = read("official-programs-2026.json")
    by_program = defaultdict(dict)
    for row in plans:
        name, track = normalized_program(row.get("program") or "")
        entry = by_program[name].setdefault(row["source_id"], {"source_id": row["source_id"], "program_as_extracted": row["program"], "track": track,
                                                           "plan_year": row.get("plan_year"), "source_url": row["source_url"], "records": 0})
        entry["records"] += 1
    coverage = []
    for item in official["programs"]:
        evidence = sorted(by_program[item["name"]].values(), key=lambda x: x.get("plan_year") or 0, reverse=True)
        recent_ordinary = [x for x in evidence if (x.get("plan_year") or 0) >= 2023 and x["track"] == "ordinary"]
        recent_special = [x for x in evidence if (x.get("plan_year") or 0) >= 2023]
        status = "recent_ordinary_source" if recent_ordinary else "recent_special_source_only" if recent_special else "historical_source_only" if evidence else "plan_source_missing"
        coverage.append({**item, "status": status, "plan_sources": evidence})
    write("program-coverage.json", {"baseline_url": official["source_url"], "baseline_version": official["source_version"],
                                    "status_definition": "资料覆盖；不保证提取完整、适用于当前年级或代表正在招生", "programs": coverage})
    stats = {**read("extraction-report.json")["statistics"], "current_mooc_courses": len(current), "historical_public_electives": len(historical),
             "curriculum_records": len(plans), "plan_documents_with_records": len({x["source_id"] for x in plans}),
             "baseline_programs": len(coverage), "program_coverage_status": dict(Counter(x["status"] for x in coverage)),
             "course_keys_needing_review": sum(bool(x["needs_review"]) for x in candidates), "source_documents": len(manifest),
             "downloaded_bytes": sum(x.get("bytes", 0) for x in manifest), "checksum_sources_checked": sum(x.get("status") == "downloaded" for x in manifest)}
    write("validation-report.json", {"statistics": stats, "checks": ["manifest_sha256", "row_provenance", "current_mooc_18_12_6_5_13", "historical_elective_toc_216"],
                                    "errors": errors, "sample_pdf_visual_checks": [{"source_id": "source-9e2a14c52e1f", "page": 4}, {"source_id": "public-elective-guide-2026-autumn", "page": 1}]})
    # README includes reviewed import status and limitations; maintain it separately.
    print(json.dumps({"statistics": stats, "errors": errors}, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
