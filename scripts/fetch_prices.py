#!/usr/bin/env python3
"""
Fetches gold/silver prices (CAD via GoldAPI, INR via a goodreturns.in scrape)
and Calgary-area gas prices (CAD, via Google Places with an NRCan fallback),
then writes the result to data/prices.json.

Add/remove tracked items by editing config/products.json -- this script
reads that file and adapts automatically for CAD (GoldAPI symbols XAU, XAG,
XPT, XPD are supported). The INR path is specific to gold + silver only,
since it's scraped from goodreturns.in's fixed gold/silver rate pages.

Required environment variables (set as GitHub Actions secrets):
  GOLDAPI_KEY        - free key from https://www.goldapi.io (100 requests/month)
  GOOGLE_MAPS_KEY    - Google Cloud API key with Places API (New) enabled

GOLDAPI_KEY is precious (only 100 requests/month), so CAD metals are only
re-fetched every `cad_refresh_every_hours` (see config/products.json) --
other runs reuse the last fetched CAD value from the previous data/prices.json.
INR (scraped) and gas (Google Places, generous quota) refresh every run.
"""

import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

GRAMS_PER_TROY_OUNCE = 31.1034768

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "config", "products.json")
OUTPUT_PATH = os.path.join(ROOT, "data", "prices.json")

GOODRETURNS_GOLD_URL = "https://www.goodreturns.in/gold-rates/"
GOODRETURNS_SILVER_URL = "https://www.goodreturns.in/silver-rates/"
SCRAPE_HEADERS = {"User-Agent": "Mozilla/5.0 (personal, non-commercial price widget)"}


def http_get_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def http_get_html(url, headers=None):
    req = urllib.request.Request(url, headers=headers or SCRAPE_HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode(errors="ignore")


def http_post_json(url, headers=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def load_previous_output():
    try:
        with open(OUTPUT_PATH) as f:
            return json.load(f)
    except Exception:
        return None


def fetch_metals_cad(config, previous):
    """GoldAPI, CAD only. Skips the actual API call (reuses `previous`'s CAD
    values) unless it's an hour divisible by cad_refresh_every_hours, to
    stay well within GoldAPI's 100 requests/month free tier."""
    refresh_every = config["metals"].get("cad_refresh_every_hours", 12)
    should_refresh = datetime.now(timezone.utc).hour % refresh_every == 0

    if not should_refresh and previous:
        carried = {}
        for name, by_currency in previous.get("metals", {}).items():
            if "CAD" in by_currency:
                carried[name] = {"CAD": by_currency["CAD"]}
        if carried:
            print("Reusing previous CAD metal prices this run (quota-saving)", file=sys.stderr)
            return carried

    api_key = os.environ.get("GOLDAPI_KEY")
    if not api_key:
        print("WARNING: GOLDAPI_KEY not set, skipping CAD metals", file=sys.stderr)
        return {}

    headers = {"x-access-token": api_key, "Content-Type": "application/json"}
    results = {}
    for item in config["metals"]["items"]:
        symbol, name = item["symbol"], item["name"]
        url = f"https://www.goldapi.io/api/{symbol}/CAD"
        try:
            data = http_get_json(url, headers=headers)
            price_per_ounce = data["price"]
        except Exception as e:
            print(f"ERROR fetching {name} in CAD: {e}", file=sys.stderr)
            continue

        price_per_gram_pure = price_per_ounce / GRAMS_PER_TROY_OUNCE
        results[name] = {"CAD": {}}
        for unit in item["units"]:
            value = price_per_gram_pure * unit["grams"] * unit["purity"]
            results[name]["CAD"][unit["label"]] = round(value, 2)

    return results


def _strip_html_to_text(raw_html):
    """Strip tags/scripts/styles and collapse whitespace, so regex can match
    against plain rendered text the way a person reading the page would see
    it -- confirmed against real goodreturns.in page dumps (Sept 2026)."""
    import html as html_lib

    text = re.sub(r"<script[^>]*>.*?</script>", " ", raw_html, flags=re.S | re.I)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text


def _extract_amount(text, pattern):
    match = re.search(pattern, text)
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except ValueError:
        return None


def fetch_metals_inr_goodreturns():
    """
    Scrape goodreturns.in's gold/silver rate pages for national INR rates.
    Patterns below were confirmed against a real page dump (Sept 2026):
      Gold page has boxes labelled "24K Gold /g Rs.15,442" and
      "22K Gold /g Rs.14,155" (per-gram; multiplied by 10 here for the
      10g units this widget tracks). Note: capital "24K"/"22K" distinguishes
      these from the site's header ticker, which uses lowercase "22k".
      Silver page has "Silver /g Rs.250" and "Silver /kg Rs.2,50,000".
    This is still a scrape of a public page, not an official API -- if
    goodreturns changes their layout, these patterns are the first thing
    to check against a fresh page dump.
    """
    result = {}

    try:
        gold_text = _strip_html_to_text(http_get_html(GOODRETURNS_GOLD_URL))
        price_24k_per_gram = _extract_amount(gold_text, r"24K Gold\s*/g\s*[\u20b9Rs\.\s]*([\d,]+)")
        price_22k_per_gram = _extract_amount(gold_text, r"22K Gold\s*/g\s*[\u20b9Rs\.\s]*([\d,]+)")
        if price_24k_per_gram or price_22k_per_gram:
            result["Gold"] = {"INR": {}}
            if price_24k_per_gram:
                result["Gold"]["INR"]["10g 24K"] = round(price_24k_per_gram * 10, 2)
            if price_22k_per_gram:
                result["Gold"]["INR"]["10g 22K"] = round(price_22k_per_gram * 10, 2)
        else:
            print("goodreturns gold scrape: no matching numbers found", file=sys.stderr)
    except Exception as e:
        print(f"ERROR scraping goodreturns gold page: {e}", file=sys.stderr)

    try:
        silver_text = _strip_html_to_text(http_get_html(GOODRETURNS_SILVER_URL))
        price_per_kg = _extract_amount(silver_text, r"Silver\s*/kg\s*[\u20b9Rs\.\s]*([\d,]+)")
        if price_per_kg:
            result["Silver"] = {"INR": {"1kg": round(price_per_kg, 2)}}
        else:
            print("goodreturns silver scrape: no matching numbers found", file=sys.stderr)
    except Exception as e:
        print(f"ERROR scraping goodreturns silver page: {e}", file=sys.stderr)

    return result


def merge_metals(cad_results, inr_results):
    merged = {}
    for name, by_currency in cad_results.items():
        merged.setdefault(name, {}).update(by_currency)
    for name, by_currency in inr_results.items():
        merged.setdefault(name, {}).update(by_currency)
    return merged


def fetch_gas_google_places(config):
    """Try Google Places (New) Nearby Search for gas station fuel prices."""
    api_key = os.environ.get("GOOGLE_MAPS_KEY")
    if not api_key:
        print("WARNING: GOOGLE_MAPS_KEY not set, skipping Google Places gas lookup", file=sys.stderr)
        return None

    loc = config["gas"]["location"]
    url = "https://places.googleapis.com/v1/places:searchNearby"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.fuelOptions",
    }
    body = {
        "includedTypes": ["gas_station"],
        "maxResultCount": 20,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": loc["lat"], "longitude": loc["lng"]},
                "radius": float(loc["radius_m"]),
            }
        },
    }

    try:
        data = http_post_json(url, headers=headers, body=body)
    except Exception as e:
        print(f"ERROR calling Google Places: {e}", file=sys.stderr)
        return None

    prices = []
    for place in data.get("places", []):
        fuel_options = place.get("fuelOptions", {})
        for fp in fuel_options.get("fuelPrices", []):
            fuel_type = fp.get("type", "")
            if "REGULAR" in fuel_type or "UNLEADED" in fuel_type:
                price = fp.get("price", {})
                if price.get("currencyCode") == "CAD":
                    units = int(price.get("units", 0))
                    nanos = price.get("nanos", 0)
                    prices.append(units + nanos / 1e9)

    if not prices:
        print("Google Places returned no usable regular-gas prices", file=sys.stderr)
        return None

    avg_price = sum(prices) / len(prices)
    return {
        "value": round(avg_price, 3),
        "source": "google_places",
        "station_count": len(prices),
    }


def fetch_gas_nrcan_fallback(config):
    """
    Fallback: scrape NRCan's public weekly retail gasoline price page for Calgary.
    This is a public government information page (not a ToS-restricted commercial
    site), but page structure can change -- if this stops working, check the
    Action logs and update the parsing below.
    """
    url = "https://natural-resources.canada.ca/energy-sources/fuel-prices/4593"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            html = resp.read().decode(errors="ignore")
    except Exception as e:
        print(f"ERROR fetching NRCan fallback page: {e}", file=sys.stderr)
        return None

    # Very small, dependency-free scrape: find "Calgary" then the next number in the row.
    idx = html.find("Calgary")
    if idx == -1:
        print("NRCan fallback: 'Calgary' not found in page", file=sys.stderr)
        return None

    window = html[idx: idx + 500]
    match = re.search(r"(\d{2,3}\.\d)", window)
    if not match:
        print("NRCan fallback: could not find a price number near 'Calgary'", file=sys.stderr)
        return None

    cents_per_litre = float(match.group(1))
    return {
        "value": round(cents_per_litre / 100, 3),
        "source": "nrcan_weekly_fallback",
        "station_count": None,
    }


def fetch_gas(config):
    if not config["gas"]["enabled"]:
        return None
    result = fetch_gas_google_places(config)
    if result is None:
        result = fetch_gas_nrcan_fallback(config)
    return result


def main():
    with open(CONFIG_PATH) as f:
        config = json.load(f)

    previous = load_previous_output()

    if config["metals"]["enabled"]:
        cad_metals = fetch_metals_cad(config, previous)
        inr_metals = fetch_metals_inr_goodreturns()
        metals = merge_metals(cad_metals, inr_metals)
    else:
        metals = {}

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "metals": metals,
        "gas": fetch_gas(config),
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
