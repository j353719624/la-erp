#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""扫描「用 text() 读 datetime 列」的潜在缺陷点（批次 NN，2026-10-15）。

## 背景
`Store.Rows` / `Store.Get` 返回的 datetime 列是 Go 的 `time.Time`
（形如 `2030-01-01 00:00:00 +0800 CST`），**不是**字符串。
而 `api.text(m, k)` 的实现是：

    v, _ := data[key].(string)
    return v

对 `time.Time` 会**静默返回空串**，不报错。批次 MM 的会计期间重叠判定
就是被这个坑过一次（`parseBoundary` 拿到空串 → 全部解析失败 → 恒不重叠）。

business 包的 `value()` 用 `fmt.Sprint` 不会静默失败，但输出是
`2030-01-01 00:00:00 +0800 CST`（空格分隔），**不是 RFC3339** ——
后续若按 RFC3339 解析同样全失败（批次 MM 同一个坑的另一半）。

## 本脚本做什么
  ① 从 schema.json 抽出所有 datetime 列 → 按表分组
  ② 扫 api 包 `text(<var>, "<col>")` 且 col 是 datetime → 高危（静默空串）
  ③ 扫 business 包 `value(<var>, "<col>")` 且 col 是 datetime → 中危（格式非 RFC3339）
  ④ 扫 `parseBoundary` 类已修复点的覆盖情况

## 局限（如实说明）
正则匹配的是「列名常量」，无法判断该 `<var>` 是否真的来自 Rows/Get
（也可能来自 decode 出来的请求体 map，那种情况是安全的字符串）。
故本脚本输出的是**待人工确认的候选**，不是确诊结果。

用法：python tools/scan-datetime-text.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA = os.path.join(ROOT, "backend", "internal", "database", "schema.json")
API_DIR = os.path.join(ROOT, "backend", "internal", "api")
BIZ_DIR = os.path.join(ROOT, "backend", "internal", "business")


def load_datetime_columns():
    with open(SCHEMA, encoding="utf-8") as fh:
        schema = json.load(fh)
    by_table = {}
    all_cols = set()
    for table in schema:
        if table.get("type") != "table":
            continue
        cols = [c["name"] for c in table.get("columns", [])
                if "datetime" in (c.get("type") or "").lower()
                or "date" == (c.get("type") or "").lower()]
        if cols:
            by_table[table["name"]] = cols
            all_cols.update(cols)
    return by_table, all_cols


TEXT_RE = re.compile(r'\btext\(\s*[\w\.\[\]"\(\)]+\s*,\s*"(\w+)"\s*\)')
VALUE_RE = re.compile(r'\bvalue\(\s*[\w\.\[\]"\(\)]+\s*,\s*"(\w+)"\s*\)')


def scan(directory, pattern, columns, kind):
    hits = []
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".go"):
            continue
        path = os.path.join(directory, name)
        with open(path, encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                code = line.split("//")[0]
                for m in pattern.finditer(code):
                    if m.group(1) in columns:
                        hits.append({
                            "kind": kind, "file": name, "line": lineno,
                            "column": m.group(1),
                            "snippet": line.strip()[:160],
                        })
    return hits


def main():
    by_table, all_cols = load_datetime_columns()
    print("schema 中 datetime 列共 %d 个，涉及 %d 张表"
          % (len(all_cols), len(by_table)))
    api_hits = scan(API_DIR, TEXT_RE, all_cols, "api.text")
    biz_hits = scan(BIZ_DIR, VALUE_RE, all_cols, "business.value")

    print("\n=== 高危：api.text() 读 datetime 列（静默返回空串）===")
    if not api_hits:
        print("（无命中）")
    for h in api_hits:
        print("  %s:%d  col=%s" % (h["file"], h["line"], h["column"]))
        print("      %s" % h["snippet"])

    print("\n=== 中危：business.value() 读 datetime 列（fmt.Sprint 输出非 RFC3339）===")
    if not biz_hits:
        print("（无命中）")
    for h in biz_hits:
        print("  %s:%d  col=%s" % (h["file"], h["line"], h["column"]))
        print("      %s" % h["snippet"])

    out = {
        "generated": "2026-10-15",
        "purpose": "批次 NN：text()/value() 读 datetime 列的影响面扫描（候选，需人工确认）",
        "datetimeColumnCount": len(all_cols),
        "tablesWithDatetime": len(by_table),
        "apiTextHits": api_hits,
        "businessValueHits": biz_hits,
    }
    path = os.path.join(ROOT, "evidence", "backend-runtime",
                        "audit-batch-nn-datetime-text-20261015.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print("\n落盘 %s" % os.path.relpath(path, ROOT))
    print("汇总：api.text 命中 %d，business.value 命中 %d" % (len(api_hits), len(biz_hits)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
