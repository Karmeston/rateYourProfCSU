"""Prepare a conservative, reproducible catalog from cross-referenced official records."""
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "course-data"


def read(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def compact(value):
    return re.sub(r"\s+", "", value or "")


def eligible_plan(row):
    year = row.get("plan_year") or 0
    return row["source_kind"] == "undergraduate_plan" and (
        year >= 2023 or (year >= 2018 and row["source_department"] == "计算机学院")
    )


def locator(row):
    position = row["locator"]
    if "page" in position:
        if "table" in position:
            return f"PDF第{position['page']}页，表{position['table']}第{position['row']}行"
        return f"PDF第{position['page']}页，第{position['line']}行附近"
    if "paragraph" in position:
        return f"正文第{position['paragraph']}段"
    if "character_offset" in position:
        return f"提取正文字符位置{position['character_offset']}"
    raise ValueError(f"Unsupported locator: {position}")


def main():
    candidates = read("catalog-candidates.json")["courses"]
    manifest = {row["id"]: row for row in read("manifest.json")}
    courses, sources, excluded = [], {}, Counter()
    for course in candidates:
        plans = [row for row in course["evidence"] if eligible_plan(row)]
        if not plans:
            continue
        explicit_plan_category = any(row.get("category_extraction_method") == "pdf_category_column"
            and re.match(r"^(?:学科|专业)教育课程(?:/|$)", row.get("course_category_raw") or "") for row in plans)
        syllabi = [row for row in course["evidence"] if row["source_kind"] == "major_syllabus"
                   and (re.search(r"学科|专业", row.get("course_category_raw") or "")
                        or (explicit_plan_category
                            and compact(row.get("course_category_raw")) in ("", "必修", "选修")))
                   and row["source_department"] != "医药信息系学院"]
        reason = None
        if course["needs_review"]:
            reason = "unresolved_record_or_name_variant"
        elif not syllabi:
            reason = "no_unambiguous_discipline_or_professional_syllabus"
        elif len({row["source_department"] for row in syllabi}) != 1:
            reason = "multiple_syllabus_departments"
        elif not re.fullmatch(r"\d{6}[A-Z]\d{2}", course.get("code") or ""):
            reason = "invalid_code"
        elif re.search(r"形势与政策|改革开放史|毛泽东|思想道德|习近平|马克思主义基本原理|中国近现代史纲要", course["name"]):
            reason = "excluded_political_course"
        if reason:
            excluded[reason] += 1
            continue
        evidence = {}
        for row in syllabi + plans:
            if compact(row["name"]) != compact(course["name"]):
                raise ValueError(f"Name mismatch: {course['code']}")
            source = manifest[row["source_id"]]
            if source["id"] not in sources:
                digest = hashlib.sha256((ROOT / source["local_file"]).read_bytes()).hexdigest()
                if digest != source["sha256"]:
                    raise ValueError(f"Original file checksum changed: {source['id']}")
                sources[source["id"]] = {
                    "url": row["source_url"], "file_url": row["source_file_url"],
                    "label": source["title"], "kind": row["source_kind"],
                    "year": row["plan_year"], "department": row["source_department"], "sha256": digest,
                }
            record = {
                "source_id": source["id"], "name": row["name"],
                "program": row.get("program"), "credits": row.get("credits"),
                "requirement": row.get("required_or_elective"),
                "category_raw": row.get("course_category_raw"),
                "category_method": row.get("category_extraction_method"), "locator": locator(row),
            }
            # A plan repeats courses in progress tables and support matrices; keep one
            # location per identical source/program/credit/requirement combination.
            key = (source["id"], record["program"], record["credits"], record["requirement"])
            evidence.setdefault(key, record)
        courses.append({
            "code": course["code"], "name": course["name"],
            "department": syllabi[0]["source_department"], "materials": list(evidence.values()),
        })
    courses.sort(key=lambda course: course["code"])
    output = {"schema_version": 1, "scope": "专业及学科课程；大纲与培养方案交叉核对，不代表当期开课",
              "sources": sources, "courses": courses}
    catalog_text = json.dumps(output, ensure_ascii=False, indent=2) + "\n"
    (DATA / "major-catalog.json").write_text(catalog_text, encoding="utf-8")
    report = {
        "courses": len(courses), "source_files_checksum_verified": len(sources),
        "material_records": sum(len(course["materials"]) for course in courses),
        "syllabus_departments": dict(Counter(course["department"] for course in courses)),
        "historical_computer_plan_only": sum(all(sources[row["source_id"]]["year"] < 2023
             for row in course["materials"] if sources[row["source_id"]]["kind"] == "undergraduate_plan")
             for course in courses),
        "excluded_candidates": dict(excluded),
        "catalog_canonical_sha256": hashlib.sha256(catalog_text.encode("utf-8")).hexdigest(),
    }
    (DATA / "major-catalog-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
