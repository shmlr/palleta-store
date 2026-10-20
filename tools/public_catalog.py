#!/usr/bin/env python3
"""Fail-closed public projection for the Palleta menu (no internal warehouse metadata).

Input is the reviewed source catalog. Output contains exactly the fields required
by the buyer application and dated, non-live club-price references.
"""
import argparse
import json
from pathlib import Path

ROOT_FIELDS = {"schema_version", "data_status", "price_freshness_hours",
               "stock_freshness_minutes", "products", "ingredients",
               "price_policy", "last_reference_import"}
PRODUCT_FIELDS = {"id", "ingredient", "name", "unit", "pack_size",
                  "pricing_mode", "price", "price_as_of", "price_source",
                  "price_type", "price_audience", "availability",
                  "compatible_with_recipe", "sold_in_palleta"}
INGREDIENT_FIELDS = {"id", "name", "unit", "product_ids", "sold_in_palleta"}
IMPORT_FIELDS = {"as_of", "updated_prices", "online_stock_confirmed"}
PRICE_POLICY_FIELDS = {"price_type", "audience", "description"}

def project_public(data):
    if not isinstance(data, dict) or data.get("schema_version") != 2:
        raise ValueError("Unexpected catalog schema")
    if not isinstance(data.get("products"), list) or not isinstance(data.get("ingredients"), list):
        raise ValueError("Product/ingredient arrays required")
    out = {
        "schema_version": 2,
        "data_status": "historical_seed_not_live",
        "price_freshness_hours": data["price_freshness_hours"],
        "stock_freshness_minutes": data["stock_freshness_minutes"],
        "price_policy": {k: v for k, v in data["price_policy"].items()
                         if k in PRICE_POLICY_FIELDS},
        "last_reference_import": {
            k: v for k, v in data.get("last_reference_import", {}).items()
            if k in IMPORT_FIELDS
        },
        "products": [],
        "ingredients": [],
    }
    for product in data["products"]:
        if not isinstance(product, dict):
            raise ValueError("Invalid product record")
        p = {k: v for k, v in product.items() if k in PRODUCT_FIELDS}
        approved = (
            p.get("price_source") == "manual_club_snapshot"
            and p.get("price_type") == "Оптовая, RUB"
            and p.get("price_audience") == "club_card"
            and isinstance(p.get("price"), (float, int))
            and not isinstance(p.get("price"), bool)
            and 0 < p["price"] < 50000
            and isinstance(p.get("price_as_of"), str)
            and len(p["price_as_of"]) == 10
        )
        if not approved:
            p["price"] = None
            p["price_as_of"] = None
            p["price_source"] = None
            p["price_type"] = None
            p["price_audience"] = None
        # Critical guard: never infer live availability from 1C warehouse quantity.
        p["availability"] = "unknown"
        out["products"].append(p)
    for ingredient in data["ingredients"]:
        if not isinstance(ingredient, dict):
            raise ValueError("Invalid ingredient")
        out["ingredients"].append({
            k: v for k, v in ingredient.items() if k in INGREDIENT_FIELDS
        })
    validate_public(out)
    return out

def validate_public(data):
    if set(data) != ROOT_FIELDS:
        raise ValueError("Unexpected public catalog top-level fields")
    for p in data["products"]:
        if not set(p).issubset(PRODUCT_FIELDS) or p.get("availability") != "unknown":
            raise ValueError("Disallowed product metadata or live stock")
        if "stock_quantity" in p or "sku_code" in p or "source" in p:
            raise ValueError("Internal warehouse data in public product")
    for ing in data["ingredients"]:
        if not set(ing).issubset(INGREDIENT_FIELDS):
            raise ValueError("Disallowed ingredient metadata")
    if set(data["price_policy"]) - PRICE_POLICY_FIELDS:
        raise ValueError("Disallowed price policy keys")
    if set(data["last_reference_import"]) - IMPORT_FIELDS:
        raise ValueError("Disallowed import metadata")
    # No free-form source notes, purchasing costs, or warehouse identifiers.
    if any(k in json.dumps(data, ensure_ascii=False) for k in
           ('"source_notes"', '"internal_code"', '"legacy_sku_code"',
            '"stock_quantity"', '"purchase_price"', '"supplier"', '"identity_key"')):
        raise ValueError("Internal records leaked into public catalog")
    return True

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    args = parser.parse_args()
    result = project_public(json.loads(args.source.read_text(encoding="utf-8")))
    args.target.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("Validated public-only catalog:", len(result["products"]), "products")

if __name__ == "__main__":
    main()
