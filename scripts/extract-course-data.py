"""Extract course facts with source-level and row/paragraph-level provenance.

Downloads stay unchanged. This writes staging JSON only; it never connects to D1.
Legacy .doc body text is prepared by extract-legacy-word.mjs. Ambiguous codes,
conflicting names and unsupported formats are retained in extraction-report.json.
"""
import argparse
import hashlib
import json
import re
import sys
import subprocess
import zipfile
from datetime import datetime, timedelta, timezone
from collections import Counter, defaultdict
from pathlib import Path

import pdfplumber
from lxml import etree, html

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "course-data"
CODE = re.compile(r"\d{6}[A-Z]\d{2}")
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def course_name(value):
    value = value or ""
    value = re.split(r"\n\s*(?=[A-Za-z])", value, maxsplit=1)[0]
    value = value.replace("\n", "").strip()
    value = re.sub(r"(?:课程)?(?:教学)?大纲$", "", value).strip()
    if len(value) > 1 and (value[0], value[-1]) in (("“", "”"), ('"', '"')):
        value = value[1:-1]
    value = re.sub(r"^《(.+)》$", r"\1", value)
    # Preserve meaningful variants such as (Python); remove only a multiword
    # English translation of the Chinese title.
    value = re.sub(r"[（(]\s*[A-Za-z][A-Za-z ,&/\-]*\s[A-Za-z][^）)]*[）)]\s*$", "", value)
    return clean(value)


def program(source, text=""):
    if source.get("program"):
        return source["program"]
    # Document title takes precedence over publication title/date.
    for line in text.splitlines()[:15]:
        if "培养方案" in line and len(line) < 100:
            return re.sub(r"(?:专业)?本科培养方案.*|(?:专业)?培养方案.*", "", line).strip()
    title = source["title"]
    if source.get("kind") == "undergraduate_plan" and "培养方案" in title:
        title = re.sub(r"^(?:20\d{2}版\s*|\d+\s*)", "", title)
        title = re.sub(r"\[20\d{2}\].*|(?:20\d{2})版|(?:专业)?(?:本科)?培养方案.*", "", title)
        return title.strip()
    return None


def base(source, text=""):
    return {"source_id": source["id"], "source_url": source["url"],
            "source_file_url": source.get("file_url", source["url"]),
            "source_department": source.get("department"), "program": program(source, text),
            "plan_year": source.get("plan_year"), "retrieved_on": source["retrieved_on"],
            "source_kind": source["kind"], "current_term_confirmed": False}


def prepare_archives():
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    ids = {x["id"] for x in manifest}
    children = []
    for source in manifest:
        if source.get("status") != "downloaded" or not source.get("local_file", "").endswith(".zip"):
            continue
        with zipfile.ZipFile(ROOT / source["local_file"]) as archive:
            for member in archive.infolist():
                suffix = Path(member.filename).suffix.lower()
                if member.is_dir() or suffix not in (".doc", ".docx", ".pdf"):
                    continue
                if member.file_size > 35 * 1024 * 1024:
                    continue
                child_id = source["id"] + "-" + hashlib.sha256(member.filename.encode()).hexdigest()[:8]
                if child_id in ids:
                    continue
                data = archive.read(member)
                # Construct our own filename instead of trusting archive paths.
                path = OUT / "raw" / (child_id + suffix)
                path.write_bytes(data)
                child = {k: v for k, v in source.items() if k not in ("links", "local_file", "sha256", "bytes")}
                member_title = Path(member.filename).name
                if not member.flag_bits & 0x800:
                    try:
                        member_title = member_title.encode("cp437").decode("gb18030")
                    except (UnicodeEncodeError, UnicodeDecodeError):
                        pass
                child.update(id=child_id, title=member_title, archive_source_id=source["id"],
                             archive_member=member.filename, local_file=path.relative_to(ROOT).as_posix(),
                             bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
                year = re.search(r"[\[（(](20\d{2})[\]）)]", member.filename)
                if year:
                    child["plan_year"] = int(year.group(1))
                children.append(child)
    for source in manifest:
        if source.get("status") != "downloaded" or not source.get("local_file", "").endswith(".rar"):
            continue
        # Native Windows bsdtar can read RAR. Stream each named member to stdout;
        # never extract archive paths onto the filesystem.
        result = subprocess.run(["tar.exe", "-tf", str(ROOT / source["local_file"])], capture_output=True, timeout=30, check=True)
        try:
            names = result.stdout.decode("utf-8").splitlines()
        except UnicodeDecodeError:
            names = result.stdout.decode("gb18030").splitlines()
        for member in names:
            suffix = Path(member).suffix.lower()
            if suffix not in (".doc", ".docx", ".pdf"):
                continue
            child_id = source["id"] + "-" + hashlib.sha256(member.encode()).hexdigest()[:8]
            if child_id in ids:
                continue
            result = subprocess.run(["tar.exe", "-xOf", str(ROOT / source["local_file"]), "--", member], capture_output=True, timeout=30, check=True)
            data = result.stdout
            if len(data) > 35 * 1024 * 1024:
                continue
            path = OUT / "raw" / (child_id + suffix)
            path.write_bytes(data)
            child = {k: v for k, v in source.items() if k not in ("links", "local_file", "sha256", "bytes")}
            child.update(id=child_id, title=Path(member).name, archive_source_id=source["id"],
                         archive_member=member, local_file=path.relative_to(ROOT).as_posix(),
                         bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            children.append(child)
    save("manifest.json", manifest + children)
    print(f"Prepared {len(children)} archive members")


def paragraphs_docx(path):
    with zipfile.ZipFile(path) as archive:
        tree = etree.fromstring(archive.read("word/document.xml"))
    paragraphs = []
    for p in tree.xpath("//w:body//w:p", namespaces=NS):
        paragraphs.append("".join(p.xpath(".//w:t/text()", namespaces=NS)))
    return paragraphs


def elective_list_docx(source, path):
    with zipfile.ZipFile(path) as archive:
        tree = etree.fromstring(archive.read("word/document.xml"))
    rows = []
    for ti, table in enumerate(tree.xpath("//w:tbl", namespaces=NS), 1):
        for ri, tr in enumerate(table.xpath("./w:tr", namespaces=NS), 1):
            cells = ["".join(tc.xpath(".//w:t/text()", namespaces=NS)) for tc in tr.xpath("./w:tc", namespaces=NS)]
            if len(cells) != 10 or not re.fullmatch(r"[1-9]-\d{2,3}", cells[0]):
                continue
            rows.append({**base(source), "name": clean(cells[1]), "code": cells[0],
                         "course_category_raw": cells[2], "credits": float(cells[3]),
                         "offering_department": cells[4], "platform": cells[6], "origin_university": cells[8],
                         "term": source["term"], "current_term_confirmed": True, "catalog_category": "elective",
                         "locator": {"table": ti, "row": ri}, "extraction_method": "official_term_elective_table", "needs_review": []})
    return rows


def syllabi(source, paragraphs, locators=None):
    records = []
    for i, text in enumerate(paragraphs):
        if not re.match(r"\s*课程(?:编[码号]|代码)\s*[：:]", text):
            continue
        meta = paragraphs[i:i + 15]
        header = next((j for j in range(i - 1, max(-1, i - 8), -1) if re.match(r"一[、.．]\s*课程(?:说明|基本信息)", paragraphs[j])), None)
        name = ""
        if header is not None:
            name = next((x.strip() for x in reversed(paragraphs[max(0, header - 5):header]) if x.strip() and re.search(r"[\u4e00-\u9fff]", x) and not re.match(r"\s*英文名", x)), "")
            name = re.sub(r"^中文名\s*[：:]\s*", "", name)
        # Some documents give an explicit course title, others only a heading.
        explicit = next((x for x in meta if re.match(r"\s*课程名称", x)), None)
        if not name and explicit and re.search(r"[：:]", explicit):
            candidate = re.split(r"[：:]", explicit, maxsplit=1)[1]
            candidate = re.split(r"[/／]", candidate, maxsplit=1)[0]
            if re.search(r"[\u4e00-\u9fff]", candidate):
                name = candidate
        name = course_name(name)
        if not name or len(name) > 100 or re.match(r"(?:一|二|三)[、.]", name):
            continue
        code_raw = re.split(r"[：:]", text, maxsplit=1)[1].strip()
        code_raw = re.split(r"课程名称", code_raw, maxsplit=1)[0].strip()
        normalized = re.sub(r"\s+", "", code_raw).replace("—", "-").replace("–", "-").replace("－", "-")
        valid = bool(CODE.fullmatch(normalized) or re.fullmatch(r"[1-9]-\d{2,3}", normalized))
        category = next((re.split(r"[：:]", x, maxsplit=1)[1].strip() for x in meta if re.match(r"\s*课程类别\s*[：:]", x)), None)
        hours = next((re.split(r"[：:]", x, maxsplit=1)[1].strip() for x in meta if re.match(r"\s*学时[/／]学分\s*[：:]", x)), None)
        applies = next((re.split(r"[：:]", x, maxsplit=1)[1].strip() for x in meta if re.match(r"\s*适用专业\s*[：:]", x)), None)
        records.append({**base(source), "name": name, "declared_name_raw": explicit, "code": normalized if valid else None, "code_raw": code_raw,
                        "course_category_raw": category, "hours_credits_raw": hours, "applicable_programs_raw": applies,
                        "catalog_category": "elective" if source["kind"] == "public_elective_syllabus" else None,
                        "locator": locators[i] if locators else {"paragraph": i + 1},
                        "extraction_method": "syllabus_metadata", "needs_review": [] if valid else ["code_format"]})
    # A few public-elective syllabi omit the code field entirely. A precise
    # course heading plus its own course-description section is still evidence.
    if source["kind"] == "public_elective_syllabus":
        found = {x["name"] for x in records}
        for i, text in enumerate(paragraphs):
            if not re.match(r"一[、.．]\s*课程说明", text):
                continue
            name = next((x.strip() for x in reversed(paragraphs[max(0, i - 5):i]) if x.strip()), "")
            name = course_name(name)
            if not name or name in found or len(name) > 60 or not re.search(r"[\u4e00-\u9fff]", name):
                continue
            end = next((j for j in range(i + 1, min(len(paragraphs), i + 30)) if re.match(r"二[、.．]", paragraphs[j])), None)
            if end is None or any(re.match(r"\s*课程(?:编[码号]|代码)\s*[：:]", p) for p in paragraphs[i:end]):
                continue
            records.append({**base(source), "name": name, "code": None, "code_raw": "",
                            "catalog_category": "elective", "hours_credits_raw": next((p for p in paragraphs[i:end] if "学时" in p), None),
                            "locator": locators[i] if locators else {"paragraph": i + 1},
                            "extraction_method": "syllabus_heading_without_code", "needs_review": ["missing_code"]})
            found.add(name)
    return records


def plans_legacy(source, text):
    records = []
    # OLE table cells are separated by tabs. Prefer the compact curriculum table;
    # the later semester tables repeat the same code/name pairs.
    pattern = re.compile(r"(?<![\dA-Z])(\d{6}[A-Z]\d{2})\s*\t([^\t]{1,250})\t\s*(必修|选修)\s*\t\s*([\d.]+)")
    for match in pattern.finditer(text):
        name = course_name(match.group(2))
        if not name or not re.search(r"[\u4e00-\u9fff]", name) or len(name) > 100:
            continue
        preceding = text[max(0, match.start() - 70):match.start()]
        categories = re.findall(r"通识教育课程|学科教育课程|专业教育课程|公共基础课|学科基础课|专业核心课|专业选修课|专业课|集中实践环节", preceding)
        records.append({**base(source, text), "name": name, "code": match.group(1), "course_category_raw": categories[-1] if categories else None,
                        "required_or_elective": match.group(3), "credits": float(match.group(4)),
                        "catalog_category": None, "locator": {"character_offset": match.start()},
                        "extraction_method": "legacy_word_table", "needs_review": []})
    return records


def plans_pdf(source, pages):
    records = []
    for page_no, page in enumerate(pages, 1):
        for ti, table in enumerate(page.extract_tables(), 1):
            for ri, row in enumerate(table, 1):
                for ci, cell in enumerate(row):
                    code = re.sub(r"\s+", "", cell or "")
                    if not CODE.fullmatch(code) or ci + 1 >= len(row):
                        continue
                    name = course_name(row[ci + 1])
                    if not name or not re.search(r"[\u4e00-\u9fff]", name) or len(name) > 100:
                        continue
                    rest = row[ci + 2:]
                    nature = next((clean(x) for x in rest if clean(x) in ("必修", "选修")), None)
                    if not nature:
                        continue  # Excludes codes in curriculum support matrices.
                    idx = next(j for j, x in enumerate(rest) if clean(x) == nature)
                    credit = clean(rest[idx + 1]) if len(rest) > idx + 1 else ""
                    records.append({**base(source, pages[0].extract_text() or ""), "name": name, "code": code,
                                    "required_or_elective": nature, "credits": float(credit) if re.fullmatch(r"\d+(\.\d+)?", credit) else None,
                                    "catalog_category": None, "locator": {"page": page_no, "table": ti, "row": ri},
                                    "extraction_method": "pdf_table", "needs_review": []})
    return records


def extract(source):
    path = ROOT / source["local_file"]
    kind = source["kind"]
    if path.suffix == ".docx":
        if kind == "public_elective_list":
            return elective_list_docx(source, path)
        ps = paragraphs_docx(path)
        records = syllabi(source, ps)
        # Future current DOCX plan support is deliberate, not guessed from prose.
        return records
    if path.suffix == ".doc":
        txt = OUT / "text" / (source["id"] + ".txt")
        if not txt.exists():
            raise ValueError("Legacy Word text not prepared")
        text = txt.read_text(encoding="utf-8")
        if "syllabus" in kind:
            return syllabi(source, text.splitlines())
        return plans_legacy(source, text)
    if path.suffix == ".pdf":
        with pdfplumber.open(path) as pdf:
            if "syllabus" in kind:
                paragraphs, locators = [], []
                for page_no, page in enumerate(pdf.pages, 1):
                    lines = (page.extract_text() or "").splitlines()
                    paragraphs += lines
                    locators += [{"page": page_no, "line": i + 1} for i in range(len(lines))]
                return syllabi(source, paragraphs, locators)
            return plans_pdf(source, pdf.pages)
    return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-archives", action="store_true")
    parser.add_argument("--ids", nargs="*")
    parser.add_argument("--pending", action="store_true", help="Extract only uncached sources")
    args = parser.parse_args()
    if args.prepare_archives:
        prepare_archives()
        return
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    # Each source's extraction is cached independently for long syllabi.
    cache = OUT / "extracted"
    cache.mkdir(exist_ok=True)
    report, records = [], []
    for source in manifest:
        if source.get("status") != "downloaded" or Path(source.get("local_file", "")).suffix not in (".doc", ".docx", ".pdf"):
            continue
        cache_file = cache / (source["id"] + ".json")
        try:
            if (args.ids and source["id"] not in args.ids) or (args.pending and cache_file.exists()):
                if not cache_file.exists():
                    continue
                rows = json.loads(cache_file.read_text(encoding="utf-8"))
            else:
                rows = extract(source)
                # Keep the first precise occurrence per source, while preserving
                # separately coded courses even when their names are identical.
                seen = set()
                rows = [x for x in rows if not ((x["code"], x["name"]) in seen or seen.add((x["code"], x["name"])))]
                cache_file.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            records += rows
            report.append({"source_id": source["id"], "title": source["title"], "kind": source["kind"], "plan_year": source.get("plan_year"),
                           "department": source.get("department"), "records": len(rows), "status": "extracted" if rows else "no_records"})
            print(f"{source['id']}: {len(rows)}", flush=True)
        except Exception as exc:
            report.append({"source_id": source["id"], "status": "failed", "error": f"{type(exc).__name__}: {exc}"})
            print(f"{source['id']}: failed: {exc}", flush=True)
    grouped = defaultdict(list)
    for row in records:
        code = row.get("code")
        # Short syllabus numbers belong to that source edition, not the modern
        # university course-code namespace. Missing codes are also source-scoped.
        key = "csu:" + code if code and CODE.fullmatch(code) else row["source_id"] + ":" + (code or row["name"])
        grouped[key].append(row)
    courses, conflicts = [], []
    for key, evidence in grouped.items():
        latest = max(evidence, key=lambda x: x.get("plan_year") or 0)
        names = sorted({x["name"] for x in evidence})
        categories = {x["catalog_category"] for x in evidence if x.get("catalog_category")}
        course = {"key": key, "name": latest["name"], "code": latest.get("code"),
                  "name_variants": names, "catalog_category": next(iter(categories)) if len(categories) == 1 else None,
                  "latest_source_year": max((x.get("plan_year") or 0 for x in evidence), default=0) or None,
                  "source_departments": sorted({x["source_department"] for x in evidence if x.get("source_department")}),
                  "programs": sorted({x["program"] for x in evidence if x.get("program")}),
                  "evidence": evidence, "needs_review": sorted({issue for x in evidence for issue in x.get("needs_review", [])})}
        if len({re.sub(r"\s+", "", name) for name in names}) > 1:
            course["needs_review"].append("code_name_variants")
            conflicts.append({"key": key, "names": names, "source_ids": sorted({x["source_id"] for x in evidence})})
        courses.append(course)
    save("course-records.json", records)
    save("catalog-candidates.json", {"schema_version": 1, "generated_on": datetime.now(timezone(timedelta(hours=8))).date().isoformat(), "imported": False, "courses": courses})
    save("extraction-report.json", {"sources": report, "code_name_conflicts": conflicts,
                                    "statistics": {"records": len(records), "course_keys": len(courses),
                                                   "elective_keys": sum(x["catalog_category"] == "elective" for x in courses),
                                                   "records_by_year": dict(Counter(x.get("plan_year") for x in records)),
                                                   "source_departments": len({x["source_department"] for x in records if x.get("source_department")})}})
    print(f"TOTAL: {len(records)} records, {len(courses)} course keys", flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
