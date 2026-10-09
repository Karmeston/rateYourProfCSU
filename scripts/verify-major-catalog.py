"""Recheck selected PDF records against their original table cells."""
import json
import re
from collections import defaultdict
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "course-data"


def compact(value):
    return re.sub(r"\s+", "", value or "")


def main():
    catalog = json.loads((DATA / "major-catalog.json").read_text(encoding="utf-8"))
    manifest = {row["id"]: row for row in json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))}
    files = defaultdict(list)
    for course in catalog["courses"]:
        for record in course["materials"]:
            source_id = record["source_id"]
            if catalog["sources"][source_id]["kind"] != "undergraduate_plan":
                continue
            path = ROOT / manifest[source_id]["local_file"]
            if path.suffix.lower() == ".pdf":
                files[path].append((course, record))
    checked = 0
    for index, (path, records) in enumerate(files.items(), 1):
        with pdfplumber.open(path) as pdf:
            tables = {}
            for course, record in records:
                page, table, row = map(int, re.fullmatch(r"PDF第(\d+)页，表(\d+)第(\d+)行", record["locator"]).groups())
                if page not in tables:
                    tables[page] = pdf.pages[page - 1].extract_tables()
                cells = tables[page][table - 1][row - 1]
                code_index = next(i for i, cell in enumerate(cells) if compact(cell) == course["code"])
                assert compact(record["name"]) in compact(cells[code_index + 1]), (course["code"], record["locator"], "name")
                nature = next(i for i in range(code_index + 2, len(cells)) if compact(cells[i]) in ("必修", "选修"))
                assert compact(cells[nature]) == record["requirement"], course["code"]
                if record["credits"] is not None:
                    assert float(compact(cells[nature + 1])) == record["credits"], (course["code"], "credits")
                checked += 1
        if index % 10 == 0:
            print(f"Verified {index}/{len(files)} PDFs, {checked} rows", flush=True)
    report_path = DATA / "major-catalog-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    report.update(pdf_tables_files_verified=len(files), pdf_table_records_verified=checked)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Verified {len(files)} PDFs, {checked} course/credit table records", flush=True)


if __name__ == "__main__":
    main()
