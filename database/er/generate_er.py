"""Draws the DemandIQ ER diagram from the SQLAlchemy models (so it always matches the schema).

  python database/er/generate_er.py        (from the project root, with the backend's virtualenv)

Writes, next to this file:
  DemandIQ_ERD.dot / .svg / .png / .pdf    Graphviz source and exports (crow's-foot notation)
  DemandIQ_ERD.mmd                         Mermaid erDiagram source (renders on GitHub, VS Code, mermaid.live)
Needs Graphviz's `dot` on the PATH for the exports (the .dot and .mmd sources are written regardless).
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "backend"))

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, Numeric, SmallInteger, String, Text, Unicode, UnicodeText  # noqa: E402

from app import models  # noqa: E402

AREAS = [
    ("Access & permissions", "#e1e5f2", ["roles", "screens", "role_screens", "permission_actions", "role_permissions", "report_types", "role_report_types"]),
    ("Accounts & audit", "#fdf3e1", ["users", "sessions", "modules", "activity_log", "error_log"]),
    ("Catalog, locations & inventory", "#e3f1ee", ["categories", "products", "regions", "locations", "inventory", "inventory_snapshots", "inventory_snapshot_items", "reorders"]),
    ("Sales data & uploads", "#e8f0fb", ["datasets", "dataset_pending_records", "sales_records"]),
    ("Forecasting", "#f3e8f6", ["forecast_runs", "forecast_points", "forecast_sources"]),
    ("Reports", "#fbe9e9", ["reports"]),
]


def type_name(column) -> str:
    t = column.type
    impl = getattr(t, "impl", t)
    if hasattr(t, "variant_mapping") and "mssql" in getattr(t, "_variant_mapping", {}):
        impl = t._variant_mapping["mssql"]
    name = type(impl).__name__.upper()
    if column.computed is not None:
        return "DECIMAL(14,2) computed"
    if isinstance(impl, (Unicode, UnicodeText)) or name in ("UNICODE", "UNICODETEXT"):
        return f"NVARCHAR({impl.length or 'MAX'})"
    if isinstance(impl, String) and not isinstance(impl, Text):
        return f"VARCHAR({impl.length})"
    if isinstance(impl, Numeric) and not isinstance(impl, Float):
        return f"DECIMAL({impl.precision},{impl.scale})"
    if isinstance(impl, Boolean):
        return "BIT"
    if isinstance(impl, SmallInteger):
        return "SMALLINT"
    if isinstance(impl, Integer):
        return "INT IDENTITY" if column.primary_key and column.autoincrement is True else "INT"
    if isinstance(impl, Float):
        return "FLOAT"
    if name in ("DATETIME2", "DATETIME") or isinstance(impl, DateTime):
        return "DATETIME2(3)"
    if name == "DATE" or isinstance(impl, Date):
        return "DATE"
    return name


def relationships():
    """(child table, child columns, parent table, nullable, one_to_one) per foreign key."""
    rels = []
    for table in models.Base.metadata.sorted_tables:
        for fk in table.foreign_key_constraints:
            cols = [c.name for c in fk.columns]
            nullable = any(table.c[c].nullable for c in cols)
            pk = [c.name for c in table.primary_key.columns]
            one_to_one = cols == pk
            rels.append((table.name, cols, fk.referred_table.name, nullable, one_to_one))
    return rels


def dot_source() -> str:
    tables = models.Base.metadata.tables
    fk_cols = {(t.name, c.parent.name) for t in tables.values() for c in t.foreign_keys}
    unique_cols = set()
    for t in tables.values():
        for constraint in t.constraints:
            if type(constraint).__name__ == "UniqueConstraint" and len(constraint.columns) == 1:
                unique_cols.add((t.name, list(constraint.columns)[0].name))
        for c in t.columns:
            if c.unique:
                unique_cols.add((t.name, c.name))
    lines = [
        "digraph DemandIQ {",
        '  graph [rankdir=LR, splines=spline, nodesep=0.35, ranksep=1.4, newrank=true, fontname="Helvetica", fontsize=22, labelloc=t, pad=0.4,',
        '         label=<<b>DemandIQ — Entity Relationship Diagram</b><br/><font point-size="13">SQL Server · 27 tables · 3NF · PK primary key · FK foreign key · UQ unique · crow\'s foot = many, bar = one, circle = optional</font>>];',
        '  node [shape=plain, fontname="Helvetica", fontsize=10];',
        '  edge [color="#1f7a8c", penwidth=1.2, fontname="Helvetica", fontsize=9, fontcolor="#022b3a"];',
    ]
    for index, (title, color, names) in enumerate(AREAS):
        lines.append(f"  subgraph cluster_{index} {{")
        lines.append(f'    label=<<b>{title.replace("&", "&amp;")}</b>>; style="rounded,filled"; fillcolor="{color}"; color="#bfdbf7"; fontsize=14;')
        for name in names:
            t = tables[name]
            rows = [f'<tr><td colspan="3" bgcolor="#022b3a" align="left"><font color="white"><b> {name} </b></font></td></tr>']
            for c in t.columns:
                keys = []
                if c.primary_key:
                    keys.append("PK")
                if (name, c.name) in fk_cols:
                    keys.append("FK")
                if (name, c.name) in unique_cols and not c.primary_key:
                    keys.append("UQ")
                key = ",".join(keys) or " "
                cname = f"<b>{c.name}</b>" if c.primary_key else (f"<i>{c.name}</i>" if c.nullable else c.name)
                bg = ' bgcolor="#dcecf0"' if c.primary_key else ""
                rows.append(
                    f'<tr><td align="left"{bg}><font color="#1f7a8c">{key}</font></td>'
                    f'<td align="left"{bg} port="{c.name}">{cname}</td><td align="left"{bg}><font color="#4d7585">{type_name(c)}{"" if not c.nullable or c.primary_key else " NULL"}</font></td></tr>'
                )
            html = '<table border="0" cellborder="1" cellspacing="0" cellpadding="3" bgcolor="white" color="#9fb7c4">' + "".join(rows) + "</table>"
            lines.append(f"    {name} [label=<{html}>];")
        lines.append("  }")
    for child, cols, parent, nullable, one_to_one in relationships():
        head = "teeodot" if nullable else "teetee"  # parent side: exactly one, or zero/one when the FK is NULL-able
        tail = "teeodot" if one_to_one else "crowodot"  # child side: many (or one for a shared primary key)
        label = f'{"0..1" if nullable else "1"} : {"0..1" if one_to_one else "0..*"}'
        target = tables[parent].primary_key.columns.values()[0].name
        lines.append(f'  {parent}:{target} -> {child}:{cols[0]} [dir=both, arrowtail={head}, arrowhead={tail}, label="{label}"];')
    lines.append("}")
    return "\n".join(lines)


def mermaid_source() -> str:
    tables = models.Base.metadata.tables
    fk_cols = {(t.name, c.parent.name) for t in tables.values() for c in t.foreign_keys}
    out = ["erDiagram"]
    for child, cols, parent, nullable, one_to_one in relationships():
        left = "|o" if nullable else "||"
        right = "o|" if one_to_one else "o{"
        out.append(f'    {parent} {left}--{right} {child} : "{", ".join(cols)}"')
    for t in models.Base.metadata.sorted_tables:
        out.append(f"    {t.name} {{")
        for c in t.columns:
            keys = []
            if c.primary_key:
                keys.append("PK")
            if (t.name, c.name) in fk_cols:
                keys.append("FK")
            kind = type_name(c).split("(")[0].replace(" ", "_")
            out.append(f"        {kind} {c.name} {','.join(keys)}".rstrip())
        out.append("    }")
    return "\n".join(out) + "\n"


def main() -> None:
    dot = HERE / "DemandIQ_ERD.dot"
    dot.write_text(dot_source(), encoding="utf-8")
    (HERE / "DemandIQ_ERD.mmd").write_text(mermaid_source(), encoding="utf-8")
    if shutil.which("dot"):
        for fmt, extra in (("svg", []), ("png", ["-Gdpi=110"]), ("pdf", [])):
            subprocess.run(["dot", f"-T{fmt}", *extra, str(dot), "-o", str(HERE / f"DemandIQ_ERD.{fmt}")], check=True)
        print("Wrote DemandIQ_ERD.dot, .mmd, .svg, .png, .pdf")
    else:
        print("Wrote DemandIQ_ERD.dot and .mmd (install Graphviz for the SVG / PNG / PDF exports)")


if __name__ == "__main__":
    main()
