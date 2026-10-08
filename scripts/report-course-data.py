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
    lines = ["# 中南大学课程数据采集结果", "", "采集日期：2026-10-07 至 2026-10-08。官方公开文件已保存，数据仅在本地整理，尚未导入网站。", "",
             f"- 当期网上 MOOC 公选课：**{len(current)} 门**，2026—2027 学年第一学期；本校 5 门、校外 13 门，超星 12 门、智慧树 6 门。",
             f"- 历史公选课：**{len(historical)} 门**，2016 版，与大纲目录逐项对应；不是当前学期开课证明。",
             f"- 培养方案：**{stats['plan_documents_with_records']} 份有课程提取结果**，合计 **{len(plans)} 条方案内课程记录**，包含不同版本、普通班和专项班。",
             f"- 全部大纲及方案：**{len(rows)} 条来源记录，{len(candidates)} 个课程候选键**；候选键不等于确认后的独立课程数量。", "",
             "## 数据文件", "", "| 文件 | 内容 |", "| --- | --- |",
             "| public-electives-current.json | 18 门当期 MOOC 公选课、代码、学分、开课单位、平台、来源位置 |",
             "| public-electives-historical.json | 216 门历史公选课；缺代码或原文错误保留待核实标记 |",
             "| curriculum-course-records.json | 培养方案内课程、专业、版本、必选修属性、学分、定位信息 |",
             "| course-records.json | 所有逐来源记录；专业课程不会因“选修”二字被归为公选课 |",
             "| catalog-candidates.json | 课程候选及各来源证据；同码异名保留，不自动导入 |",
             "| program-coverage.json | 按学校官方专业目录逐项列出来源覆盖和缺口 |",
             "| manifest.json / sources.json | 来源网址、抓取日期、原始文件路径、SHA-256；包括网页附件和压缩包成员 |",
             "| extraction-report.json / validation-report.json | 每文件提取数量、异常、同码异名和核验结果 |", "",
             "原文件在 `raw/`，旧 Word 的中间文本在 `text/`，逐源缓存在 `extracted/`。这些体积较大的可重新获取文件保留在本机并被 Git 忽略。", "",
             "## 覆盖范围和限制", "",
             f"以 [学校2026年8月专业目录]({official['source_url']}) 的 {len(coverage)} 个条目为基准（含停止招生条目），来源覆盖如下：", "",
             "| 状态 | 专业目录条目数 |", "| --- | ---: |"]
    labels = {"recent_ordinary_source": "已有2023版或之后普通培养方案来源", "recent_special_source_only": "近期只有强基/卓越/国际等专项方案", "historical_source_only": "只有历史培养方案来源", "plan_source_missing": "尚未取得培养方案"}
    for status, label in labels.items():
        lines.append(f"| {label} | {stats['program_coverage_status'].get(status, 0)} |")
    lines += ["", "资料覆盖不等于完整提取或当前培养要求。大类方案单独保留，没有据此宣称覆盖整个大类的所有专业。强基/卓越方案不能替代普通班方案。", "",
              "2016 版大纲覆盖当年 33 个学院/教学单位，保留历史学院名称；这不能证明已取得每个专业的培养方案。原始来源学院也不等于实际开课单位。", "",
              "当期名单目前覆盖网上 MOOC；完整线下公选课目录仍需从本科教务系统的课程目录/开课表取得。最新普通培养方案缺口优先通过各院本科教务办提供的正式文件或学生本人能合法导出的培养方案补齐。不会索取账号密码。", "",
              f"候选中有 {stats['course_keys_needing_review']} 个键需要核实（含原文代码异常、名称变体等）。来源有更新时按年级和专业选用；同名不同代码不强行合并。", "",
              "原始资料保留思政及其他学校实际课程证据；按本项目现有规则，思政课程应在导入阶段排除。本次未改线上目录或已有迁移。", "",
              "## 当期MOOC课程", "", "| 代码 | 名称 | 学分 | 开课单位 | 平台 |", "| --- | --- | ---: | --- | --- |"]
    lines += [f"| {x['code']} | {x['name']} | {x['credits']:g} | {x['offering_department']} | {x['platform']} |" for x in current]
    lines += ["", "## 复现", "", "在项目根目录使用带 lxml、pdfplumber 的 Python 运行（桌面自带 Python 已验证）；旧 Word 解析器固定为 word-extractor 1.0.4：", "", "```powershell",
              "npm install --prefix tmp/course-parser --no-save --package-lock=false --ignore-scripts word-extractor@1.0.4",
              "python scripts/collect-course-sources.py --pending", "python scripts/discover-course-sources.py", "python scripts/collect-course-sources.py --pending",
              "python scripts/extract-course-data.py --prepare-archives", "node scripts/extract-legacy-word.mjs", "python scripts/extract-course-data.py", "python scripts/report-course-data.py", "```", "",
              "`--pending` 提取复用本地缓存；修改解析器后运行完整提取命令。新电脑下载后，原始内容可能已被学校更新，应检查 SHA-256；清单中的抓取日期不会冒充文件版本。RAR 使用 Windows 自带 tar 流式读取成员，不执行文档。", "",
              "## 官方入口", "",
              "- [当期MOOC通知及附件](https://oa.csu.edu.cn/con/PDFPage?JLNM=C2A7465AF8944A2D8B8BBD47419A99D1&YWMC=ZNDX_ZHBG_GGTZ)",
              "- [2016版全校性选修课大纲](https://bksy.csu.edu.cn/info/1272/3699.htm)",
              "- [本科生院课程教学大纲目录](https://bksy.csu.edu.cn/jxyz1/kcjs11.htm)",
              "- [自动化学院培养方案](https://soa.csu.edu.cn/jyjx/bksjy/pyfa.htm)", ""]
    (OUT / "README.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"statistics": stats, "errors": errors}, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
