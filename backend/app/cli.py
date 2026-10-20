"""Command line: python -m app.cli <command>

  check-db         connect to the configured database and print the server version and row counts
  create-tables    create the tables from the SQLAlchemy models (development databases; on SQL Server
                   run database/01_schema.sql instead — it also creates the sequences and views)
  seed             replace all rows with the demo data (database/seed/demo-data.json)
  build-seed-sql   write database/02_seed.sql (the same demo data as a SQL Server script)
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import func, select, text

from . import models
from .config import PROJECT_DIR, get_settings
from .database import configure, session_factory


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["check-db", "create-tables", "seed", "build-seed-sql"])
    parser.add_argument("--url", help="SQLAlchemy URL (default: DATABASE_URL / MSSQL_* settings)")
    parser.add_argument("--out", help="build-seed-sql: output file", default=str(PROJECT_DIR / "database" / "02_seed.sql"))
    args = parser.parse_args(argv)
    settings = get_settings()

    from .seed.loader import build_rows, load, read_seed, write_sql

    if args.command == "build-seed-sql":
        data = read_seed(settings.seed_file)
        rows = build_rows(data, bcrypt_rounds=settings.bcrypt_rounds)
        from pathlib import Path

        write_sql(rows, Path(args.out), source="database/seed/demo-data.json", time_zone=data.get("timeZone", "Asia/Kolkata"))
        print(f"Wrote {args.out}: {sum(len(v) for v in rows.values()):,} rows in {len(rows)} tables")
        return 0

    engine = configure(args.url)
    if args.command == "create-tables":
        models.Base.metadata.create_all(engine)
        print(f"Created {len(models.Base.metadata.tables)} tables on {engine.url.render_as_string(hide_password=True)}")
        return 0
    with session_factory()() as db:
        if args.command == "check-db":
            dialect = engine.dialect.name
            version = db.execute(text("SELECT @@VERSION" if dialect == "mssql" else "SELECT sqlite_version()")).scalar()
            print(f"Connected: {engine.url.render_as_string(hide_password=True)}\n{str(version).splitlines()[0]}")
            for model in (models.User, models.Product, models.SalesRecord, models.ForecastRun, models.Dataset):
                print(f"  {model.__tablename__:<16} {db.execute(select(func.count()).select_from(model)).scalar_one():>7,}")
            return 0
        if args.command == "seed":
            data = read_seed(settings.seed_file)
            counts = load(db, build_rows(data, bcrypt_rounds=settings.bcrypt_rounds))
            if engine.dialect.name == "mssql":
                from .seed.loader import sequence_restarts

                for sequence, value in sequence_restarts(build_rows(data, bcrypt_rounds=4)):
                    db.execute(text(f"ALTER SEQUENCE dbo.{sequence} RESTART WITH {int(value)}"))
            db.commit()
            for table, n in counts.items():
                print(f"  {table:<26} {n:>7,}")
            print(f"Seeded {sum(counts.values()):,} rows")
            return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
