"""Expand selected public index/plan pages into attachment and plan sources.

Only follows links present in saved source pages. Does not crawl arbitrary sites.
Review sources.json before collecting a newly discovered batch.
"""
import hashlib
import json
import re
import runpy
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "course-data"
helpers = runpy.run_path(str(ROOT / "scripts" / "collect-course-sources.py"))
links = helpers["links"]


def canonical(url):
    p = urllib.parse.urlsplit(url.strip())
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(sorted(urllib.parse.parse_qsl(p.query))), ""))


def main():
    sources_path = OUT / "sources.json"
    sources = json.loads(sources_path.read_text(encoding="utf-8"))
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    known = {canonical(x.get("file_url", x["url"])) for x in sources}
    added = []
    for item in manifest:
        if not item.get("local_file", "").endswith((".html", ".json")):
            continue
        if "/yjs" in item["url"]:
            continue
        data = (ROOT / item["local_file"]).read_bytes()
        if item.get("kind") == "attachment_index":
            candidates = [(x["FJMC"], "https://oa.csu.edu.cn/con/xnbg/downLoadFj?" + urllib.parse.urlencode({"NBBM": x["NBBM"], "fullfilename": x["FJMC"]})) for x in json.loads(data) if "课程信息" in x["FJMC"]]
        else:
            candidates = links(data, item["url"])
        # CSU's PDF viewer embeds the direct URL in a script rather than a link.
        candidates += [(item["title"] + " PDF", urllib.parse.urljoin(item["url"], u)) for u in re.findall(
            r'(?:showVsbpdfIframe|src)\s*\(?\s*[\'"]([^\'"]+\.pdf)[\'"]', data.decode("utf-8", errors="replace"))]
        candidates += [(item["title"] + " PDF", urllib.parse.urljoin(item["url"], u)) for u in re.findall(
            r'var\s+url\s*=\s*[\'"]([^\'"]*download\.jsp[^\'"]*)[\'"]', data.decode("utf-8", errors="replace"))]
        for title, url in candidates:
            if not helpers["public_url"](url) or canonical(url) in known:
                continue
            attachment = "download.jsp" in url or "/downLoadFj?" in url or bool(re.search(r"\.(pdf|docx?|zip)(?:\?|$)", url, re.I))
            original_title = title
            # Some indexes put a full article teaser inside the link. Restrict
            # classification to its title, not degree names in the teaser.
            if "培养方案" in title:
                title = title[:title.index("培养方案") + len("培养方案")] + (".doc" if attachment and ".doc" in title else "")
            plan = bool(re.search(r"培养方案|课程.*大纲", title)) and not re.search(r"研究生|硕士|博士|修订机制|修订实施办法|工作方案|指导意见|通知|实施细则|召开|研讨会|解读大会", original_title)
            year = re.search(r"[\[（(](20\d{2})(?:版)?[\]）)]|(20\d{2})[版年]|(20\d{2})(?:日语|英语|哲学|法语|西班牙语)", original_title)
            year_value = int(next(x for x in year.groups() if x)) if year else item.get("plan_year")
            historical_syllabus = "2016版" in title and "课程教学大纲" in title
            pagination = item.get("kind") == "index" and item["title"].count("下一页") < 2 and title in ("下页", "下一页", "尾页") and urllib.parse.urlparse(url).netloc == urllib.parse.urlparse(item["url"]).netloc
            undergraduate_nav = item.get("kind") == "college_home" and (("培养方案" in title and "/bks" in url) or title in ("本科生教育", "本科生培养", "本科教育"))
            undated_plan = (plan and not year and item.get("kind") == "index"
                            and "专业本科培养方案" in title and not re.search(r"\d{2}版", original_title)
                            and "/yjs" not in url)
            if not (attachment or (plan and year and year_value >= item.get("min_plan_year", 2023)) or undated_plan or historical_syllabus or pagination or undergraduate_nav):
                continue
            if attachment and not (plan or "课程" in title or item.get("kind") in ("plan_page", "syllabus_page")):
                continue
            source = {"id": "source-" + hashlib.sha256(canonical(url).encode()).hexdigest()[:12],
                      "title": title[:180], "url": item["url"] if attachment else url,
                      "kind": ("major_syllabus" if "大纲" in title or item.get("kind") == "syllabus_page" else "undergraduate_plan") if attachment else "plan_page",
                      "discovered_from": item["id"]}
            if attachment:
                source["file_url"] = url
                if item.get("kind") == "attachment_index":
                    source["kind"] = "public_elective_list"
                    source["term"] = item["term"]
            if item.get("department"):
                source["department"] = item["department"]
            if year_value:
                source["plan_year"] = year_value
            if pagination:
                source["title"] = item["title"] + " 下一页"
                source["kind"] = "index"
            if undergraduate_nav:
                source["kind"] = "index"
            if historical_syllabus:
                source["kind"] = "syllabus_page"
                source["plan_year"] = 2016
                match = re.search(r"2016版(.+?)本科", title)
                if match:
                    source["department"] = match.group(1)
            known.add(canonical(url))
            sources.append(source)
            added.append(source)
    sources_path.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for source in added:
        print(json.dumps(source, ensure_ascii=False))
    print(f"Added {len(added)} sources")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
