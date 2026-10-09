"""Extraction regressions; synthetic tables require no network or source downloads."""
import runpy
import unittest
from pathlib import Path

helpers = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/extract-course-data.py"))


class Page:
    def __init__(self, text, table):
        self.text, self.table = text, table

    def extract_text(self):
        return self.text

    def extract_tables(self):
        return [self.table]


class PlanExtractionTest(unittest.TestCase):
    def test_compilation_preserves_program_credit_requirement_and_category(self):
        header = ["课程类别", None, "课程编号", "课程名称", "课程属性", "学分"]
        pages = [
            Page("资源勘查工程专业本科培养方案", [header,
                ["学科\n教育\n课程", "学科基础课", "010101X10", "新生课", "必修", "1"]]),
            Page("课程表续", [header,
                ["", "", "010102Z10", "结晶矿物学", "必修", "4"]]),
            Page("资源勘查工程卓越人才培养本科培养方案", [header,
                ["专业教育课程", "专业选修课", "010101X10", "新生课", "选修", "2"]]),
            Page("教学进程表", [["课程编号", "课程名称", "属性", "学分"],
                ["010102Z10", "结晶矿物学", "必修", "4"]]),
        ]
        source = {"id": "fixture", "url": "https://gip.csu.edu.cn/fixture.pdf",
                  "title": "学院培养方案汇编", "kind": "undergraduate_plan", "retrieved_on": "2026-10-10"}
        rows = helpers["plans_pdf"](source, pages)
        self.assertEqual([row["program"] for row in rows],
                         ["资源勘查工程", "资源勘查工程", "资源勘查工程卓越人才培养", "资源勘查工程卓越人才培养"])
        self.assertEqual(rows[1]["course_category_raw"], "学科教育课程/学科基础课")
        self.assertEqual(rows[2]["course_category_raw"], "专业教育课程/专业选修课")
        self.assertIsNone(rows[3]["course_category_raw"])
        self.assertEqual(rows[2]["locator"], {"page": 3, "table": 1, "row": 2})
        self.assertEqual((rows[2]["credits"], rows[2]["required_or_elective"]), (2, "选修"))
        # Same code/name in different tracks must survive source-level deduplication.
        identity = helpers["record_identity"]
        self.assertNotEqual(identity(rows[0]), identity(rows[2]))
        alternative = {**rows[0], "credits": 3}
        self.assertNotEqual(identity(rows[0]), identity(alternative))
        alternative = {**rows[0], "required_or_elective": "选修"}
        self.assertNotEqual(identity(rows[0]), identity(alternative))


if __name__ == "__main__":
    unittest.main()
