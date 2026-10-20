"""The hand-written SQL Server DDL (database/01_schema.sql), the SQLAlchemy models and the seed script
(database/02_seed.sql) describe the same database."""
import re
from pathlib import Path

from app import models
from app.config import PROJECT_DIR

from .conftest import seed_rows

DDL = (PROJECT_DIR / "database" / "01_schema.sql").read_text(encoding="utf-8")
SEED = PROJECT_DIR / "database" / "02_seed.sql"


def ddl_tables() -> dict[str, list[str]]:
    tables = {}
    for match in re.finditer(r"CREATE TABLE dbo\.(\w+) \((.*?)\n\);", DDL, re.S):
        columns = []
        for line in match.group(2).splitlines():
            line = line.strip()
            if not line or line.startswith(("CONSTRAINT", "--", "(")) or not re.match(r"^[a-z_0-9]+ ", line):
                continue
            columns.append(line.split()[0])
        tables[match.group(1)] = columns
    return tables


def test_ddl_and_models_have_the_same_tables_and_columns():
    ddl = ddl_tables()
    assert len(ddl) == 27
    assert set(ddl) == set(models.Base.metadata.tables)
    for name, table in models.Base.metadata.tables.items():
        assert ddl[name] == [c.name for c in table.columns], name


def test_ddl_declares_every_foreign_key_of_the_models():
    for name, table in models.Base.metadata.tables.items():
        block = re.search(rf"CREATE TABLE dbo\.{name} \((.*?)\n\);", DDL, re.S).group(1)
        for fk in table.foreign_keys:
            target = f"REFERENCES dbo.{fk.column.table.name} ({fk.column.name})"
            assert target in block, f"{name}.{fk.parent.name} → {target}"


def test_ddl_has_the_sequences_the_backend_uses():
    from app.core.ids import SEQUENCES

    for sequence, _, _ in SEQUENCES.values():
        assert f"CREATE SEQUENCE dbo.{sequence} " in DDL


def test_seed_script_matches_the_seed_rows():
    text = SEED.read_text(encoding="utf-8")
    for name, rows in seed_rows().items():
        assert f"-- {name}: {len(rows):,} rows" in text, name
    for name, table in models.Base.metadata.tables.items():
        columns = ", ".join(c.name for c in table.columns if c.computed is None)
        if seed_rows()[name]:
            assert f"INSERT INTO dbo.{name} ({columns}) VALUES" in text, name


def test_third_normal_form_choices():
    """Derived values are not stored (they are worked out by the API and the views)."""
    columns = {name: {c.name for c in t.columns} for name, t in models.Base.metadata.tables.items()}
    assert "initials" not in columns["users"]
    assert not {"status", "suggested", "days"} & columns["inventory"]
    assert "forecast_date" not in columns["forecast_points"]
    assert "region" not in columns["products"] and "region_id" in columns["locations"]
    assert "location_id" in columns["sales_records"]  # sales by region: sale → location → region
    assert "created_at" in columns["error_log"] and "at" not in columns["error_log"]
    assert models.SalesRecord.__table__.c.net_revenue.computed is not None
