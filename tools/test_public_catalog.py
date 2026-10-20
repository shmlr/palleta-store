#!/usr/bin/env python3
"""Security regression tests for the public buyer catalog (no credentials)."""
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from public_catalog import project_public, validate_public, ROOT_FIELDS, PRODUCT_FIELDS, INGREDIENT_FIELDS

STORE = Path(__file__).resolve().parent.parent

class PublicCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = json.loads((STORE / "menu/products.json").read_text(encoding="utf-8"))

    def test_public_store_schema(self):
        validate_public(self.current)
        self.assertEqual(set(self.current), ROOT_FIELDS)
        self.assertEqual(len(self.current["products"]), 30)
        self.assertEqual(self.current["data_status"], "historical_seed_not_live")

    def test_no_sensitive_fields_recursively(self):
        raw = json.dumps(self.current, ensure_ascii=False)
        for key in ['"source_notes"','"source_group"','"internal_code"','"sku_code"',
                    '"legacy_sku_code"','"stock_quantity"','"supplier"',
                    '"purchase_price"','"identity_key"','"barcode"','"source"']:
            self.assertNotIn(key, raw, key)
        for p in self.current["products"]:
            self.assertTrue(set(p).issubset(PRODUCT_FIELDS))
            self.assertEqual(p["availability"], "unknown")
        for i in self.current["ingredients"]:
            self.assertTrue(set(i).issubset(INGREDIENT_FIELDS))

    def test_injection_never_reaches_public_output(self):
        source=json.loads(json.dumps(self.current))
        source["source_notes"]=["123 kg internal warehouse stock; buying cost secret"]
        source["products"][0].update({
            "internal_code":"HIDDEN-SECRET", "sku_code":"SECRET",
            "source":"warehouse 1000 kg", "stock_quantity":700,
            "availability":"in_stock", "availability_checked_at":"2026-10-20T10:00:00Z",
            "purchase_price":999, "assortment_note":"internal"
        })
        source["ingredients"][0]["source_group"]="internal warehouse name"
        result=project_public(source)
        self.assertNotIn("123 kg internal",json.dumps(result,ensure_ascii=False))
        self.assertNotIn("HIDDEN-SECRET",json.dumps(result,ensure_ascii=False))
        self.assertEqual(result["products"][0]["availability"],"unknown")
        validate_public(result)

    def test_reject_unreviewed_prices(self):
        source=json.loads(json.dumps(self.current))
        source["products"][0].update({
            "price":3.14,"price_source":"working_retail",
            "price_type":"Розничная, RUB","price_as_of":"2026-10-20"
        })
        sanitized=project_public(source)
        self.assertIsNone(sanitized["products"][0]["price"])
        self.assertIsNone(sanitized["products"][0]["price_as_of"])

    def test_source_to_public_idempotent(self):
        result=project_public(self.current)
        self.assertEqual(result,self.current,"public projection must be stable")

if __name__=="__main__":
    unittest.main(verbosity=2)
