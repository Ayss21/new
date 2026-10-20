"""The upload reader (app/domain/sales_import.py) gives the same result as the frontend's reference
implementation (src/lib/salesImport.js) on every layout in fixtures/import_cases.json.
fixtures/import_expected.json is written by `node scripts/import-parity.mjs` in demandiq-react."""
import json
from pathlib import Path

import pytest

from app.domain.sales_import import detect_delimiter, import_sales, read_date, read_number, split_delimited

FIXTURES = Path(__file__).parent / "fixtures"
CASES = json.loads((FIXTURES / "import_cases.json").read_text(encoding="utf-8"))
EXPECTED = json.loads((FIXTURES / "import_expected.json").read_text(encoding="utf-8"))

CATALOG = [
    {"sku": "PP-4012", "name": "Polypropylene 4012", "category": "Polymers", "location": "Central DC", "region": "Central", "channel": "Direct", "unitPrice": 248},
    {"sku": "PE-7820", "name": "HDPE Resin 7820", "category": "Polyethylene", "location": "East Hub", "region": "East", "channel": "Distributor", "unitPrice": 224},
    {"sku": "CH-2155", "name": "Glycol Industrial", "category": "Chemicals", "location": "East DC", "region": "East", "channel": "Direct", "unitPrice": 316},
    {"sku": "PC-3308", "name": "Polycarbonate 3308", "category": "Specialties", "location": "West Hub", "region": "West", "channel": "Distributor", "unitPrice": 382},
    {"sku": "FE-1094", "name": "Fertilizer Grade 1094", "category": "Agri-Nutrients", "location": "North Hub", "region": "North", "channel": "Direct", "unitPrice": 174},
    {"sku": "PS-5510", "name": "Styrene Resin 5510", "category": "Chemicals", "location": "South DC", "region": "South", "channel": "Direct", "unitPrice": 286},
    {"sku": "AB-6621", "name": "ABS Resin 6621", "category": "Specialties", "location": "Central Hub", "region": "Central", "channel": "Distributor", "unitPrice": 344},
    {"sku": "ME-7732", "name": "Methanol Grade 7732", "category": "Chemicals", "location": "North DC", "region": "North", "channel": "Direct", "unitPrice": 198},
    {"sku": "EV-8843", "name": "EVA Copolymer 8843", "category": "Polymers", "location": "West DC", "region": "West", "channel": "Distributor", "unitPrice": 312},
    {"sku": "UR-9954", "name": "Urea Industrial 9954", "category": "Agri-Nutrients", "location": "South Hub", "region": "South", "channel": "Direct", "unitPrice": 166},
    {"sku": "LL-2468", "name": "LLDPE Resin 2468", "category": "Polyethylene", "location": "East Hub", "region": "East", "channel": "Distributor", "unitPrice": 236},
]


def run(text: str) -> dict:
    result = import_sales(split_delimited(text, detect_delimiter(text)), CATALOG)
    return {**result, "records": [{k: v for k, v in r.items() if k != "id"} for r in result["records"]]}


@pytest.mark.parametrize("name", sorted(CASES))
def test_same_result_as_the_frontend(name):
    assert json.loads(json.dumps(run(CASES[name]))) == EXPECTED[name]


def test_values():
    assert read_date("2025/6/26 14:05") == "2025-06-26"
    assert read_date("26-06-25") == "2025-06-26"
    assert read_date("June 26, 2025") == "2025-06-26"
    assert read_date("45834") == "2025-06-26"
    assert read_date("31/02/2025") is None
    assert read_number("₹ 1,248") == {"value": 1248.0, "percent": False}
    assert read_number("1.234,5") == {"value": 1234.5, "percent": False}
    assert read_number("(5)") == {"value": -5.0, "percent": False}
    assert read_number("12%") == {"value": 12.0, "percent": True}
    assert read_number("P0001") is None
    assert detect_delimiter("Sales report, June\nDate;Product;Qty\n2025-06-26;PP-4012;4\n") == ";"
