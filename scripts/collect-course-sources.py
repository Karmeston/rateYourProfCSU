"""Download explicitly selected CSU public course sources, keeping provenance.

Uses TLS certificate verification and never attempts authentication. Attachment
download pages are resolved only through links/redirects actually returned by CSU.
Run with the bundled Python runtime; lxml is the only non-standard dependency.
"""
import argparse
import concurrent.futures
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from lxml import html

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "course-data"


def public_url(url):
    parsed = urllib.parse.urlparse(url)
    return parsed.scheme in ("https", "http") and (
        parsed.hostname == "csu.edu.cn" or (parsed.hostname or "").endswith(".csu.edu.cn")
    )


def fetch(url, referer=None, request_form=None):
    if not public_url(url):
        raise ValueError("Source must be a public CSU URL")
    headers = {"User-Agent": "Mozilla/5.0 (compatible; CSUCourseCatalog/1.0)", "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    # Windows curl uses the system TLS implementation, which works on networks
    # where the bundled Python/OpenSSL handshake is reset. Verification stays on.
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "response"
        command = ["curl.exe", "--silent", "--show-error", "--fail", "--location",
                   "--max-redirs", "4", "--connect-timeout", "8", "--max-time", "35",
                   "--max-filesize", str(35 * 1024 * 1024), "--proto", "=http,https",
                   "--output", str(path), "--write-out", "%{url_effective}\n%{content_type}",
                   "--user-agent", headers["User-Agent"]]
        if referer:
            command += ["--referer", referer]
        if request_form:
            command += ["--data", urllib.parse.urlencode(request_form)]
        result = subprocess.run(command + [url], capture_output=True, timeout=40)
        if result.returncode:
            raise ValueError(result.stderr.decode("utf-8", errors="replace").strip())
        final, _, content_type = result.stdout.decode("utf-8").partition("\n")
        final = final.strip()
        content_type = content_type.strip()
        if not public_url(final) or urllib.parse.urlparse(final).hostname == "ca.csu.edu.cn":
            raise ValueError("Authentication or non-CSU redirect; no content collected")
        return path.read_bytes(), final, content_type


def links(data, url):
    tree = html.fromstring(data, parser=html.HTMLParser(encoding="utf-8"))
    tree.make_links_absolute(url)
    return [(" ".join(a.text_content().split()), (a.get("href") or "").strip()) for a in tree.xpath("//a[@href]")]


def attachment_target(data, url):
    text = data.decode("utf-8", errors="replace")
    targets = [href for _, href in links(data, url) if href and (
        re.search(r"\.(pdf|docx?|xlsx?|zip)(?:\?|$)", href, re.I) or "/__local/" in href)]
    targets += [urllib.parse.urljoin(url, x) for x in re.findall(
        r'(?:location(?:\.href)?\s*=|url\s*[:=])\s*[\'"]([^\'"]+)[\'"]', text, re.I)]
    return next((x for x in targets if public_url(x)), None)


def collect(source):
    item = dict(source)
    item["retrieved_on"] = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    try:
        url = item.get("file_url", item["url"])
        for _ in range(4):
            data, final, content_type = fetch(url, item["url"], item.get("request_form"))
            if data.startswith(b"%PDF"):
                ext = ".pdf"
                break
            if data.startswith(b"PK\x03\x04"):
                ext = ".docx" if "word/document.xml" in zipfile.ZipFile(io.BytesIO(data)).namelist() else ".zip"
                break
            if data.startswith(bytes.fromhex("d0cf11e0a1b11ae1")):
                ext = ".doc"
                break
            if data.startswith(b"Rar!\x1a\x07"):
                ext = ".rar"
                break
            if data.lstrip().startswith((b"[", b"{")):
                json.loads(data)
                ext = ".json"
                break
            if "download.jsp" in final:
                target = attachment_target(data, final)
                if target and target != url:
                    url = target
                    continue
            ext = ".html"
            break
        else:
            raise ValueError("Attachment resolution exceeded limit")
        path = OUT / "raw" / (item["id"] + ext)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        item.update(status="downloaded", final_url=final, local_file=path.relative_to(ROOT).as_posix(),
                    bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), content_type=content_type)
        if ext == ".html":
            item["links"] = [{"title": title, "url": href} for title, href in links(data, final)
                             if href and public_url(href) and (re.search(r"培养方案|课程|\.doc|\.pdf", title + href))]
            if "download.jsp" in final:
                item["status"] = "attachment_page_only"
        print(json.dumps({"id": item["id"], "status": item["status"], "bytes": len(data), "file": item["local_file"]}, ensure_ascii=False), flush=True)
    except Exception as exc:
        item.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        print(json.dumps({"id": item["id"], "status": "failed", "error": item["error"]}, ensure_ascii=False), flush=True)
    return item


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", type=Path, default=OUT / "sources.json")
    parser.add_argument("--ids", nargs="*")
    parser.add_argument("--pending", action="store_true", help="Skip successfully downloaded unchanged sources")
    args = parser.parse_args()
    sources = json.loads(args.sources.read_text(encoding="utf-8"))
    manifest_path = OUT / "manifest.json"
    existing = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else []
    merged = {x["id"]: x for x in existing}
    selected = [x for x in sources if not args.ids or x["id"] in args.ids]
    if args.pending:
        selected = [x for x in selected if merged.get(x["id"], {}).get("status") != "downloaded"
                    or merged.get(x["id"], {}).get("url") != x["url"]
                    or merged.get(x["id"], {}).get("file_url") != x.get("file_url")]
    # Correct reviewed metadata even when the original download is cached.
    for source in sources:
        if source["id"] in merged:
            merged[source["id"]].update(source)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for item in pool.map(collect, selected):
            merged[item["id"]] = item
    manifest_path.write_text(json.dumps(list(merged.values()), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
