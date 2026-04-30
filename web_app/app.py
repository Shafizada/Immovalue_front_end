from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlparse

import joblib
import numpy as np
import pandas as pd


PROJECT_ROOT = Path(r"C:\Users\a00555308\Private\ML\immovalue_model")
STATIC_DIR = Path(__file__).resolve().parent / "static"
MODEL_PATH = PROJECT_ROOT / "models" / "apartment_price_random_forest.pkl"
ENGINEERED_DATA_PATH = PROJECT_ROOT / "data" / "processed" / "engineered_data.csv"

EPC_LABEL_ENCODING = {
    "A": 7,
    "B": 6,
    "C": 5,
    "D": 4,
    "E": 3,
    "F": 2,
    "G": 1,
    "a": 7,
    "b": 6,
    "c": 5,
    "d": 4,
    "e": 3,
    "f": 2,
    "g": 1,
    "Unknown": 0,
}

NUMERIC_INPUTS = {
    "postcode",
    "surface_area_m2",
    "bedrooms",
    "bathrooms",
    "floor",
    "year_built",
    "facade_count",
    "condition_score",
    "epc_score_kwh_m2_year",
    "terrace_area_m2",
    "garden_area_m2",
    "monthly_cost_eur",
    "cadastral_income_eur",
}

FLAG_INPUTS = {
    "terrace_yes_no",
    "garden_yes_no",
    "garage_yes_no",
    "parking_yes_no",
    "lift_yes_no",
    "double_glazing_yes_no",
    "energy_renovation_required_yes_no",
    "electricity_conform_yes_no",
    "flood_area_yes_no",
    "newbuild_yes_no",
}

DEFAULT_INPUT = {
    "postcode": 2000,
    "city": "Antwerp",
    "property_type": "Apartment",
    "property_subtype": "Apartment",
    "surface_area_m2": 85,
    "bedrooms": 2,
    "bathrooms": 1,
    "floor": 3,
    "year_built": 1995,
    "facade_count": 2,
    "condition_score": 4,
    "epc_label": "B",
    "epc_score_kwh_m2_year": 120,
    "terrace_yes_no": 1,
    "terrace_area_m2": 10,
    "garden_yes_no": 0,
    "garden_area_m2": 0,
    "garage_yes_no": 0,
    "parking_yes_no": 1,
    "lift_yes_no": 1,
    "double_glazing_yes_no": 1,
    "energy_renovation_required_yes_no": 0,
    "electricity_conform_yes_no": 1,
    "flood_area_yes_no": 0,
    "newbuild_yes_no": 0,
    "monthly_cost_eur": 150,
    "cadastral_income_eur": 900,
}


def load_model():
    model = joblib.load(MODEL_PATH)
    model_step = model.named_steps.get("model") if hasattr(model, "named_steps") else None
    if hasattr(model_step, "n_jobs"):
        model_step.n_jobs = 1
    return model


MODEL = load_model()
EXPECTED_FEATURES = list(MODEL.feature_names_in_)
HISTORICAL_DF = (
    pd.read_csv(ENGINEERED_DATA_PATH) if ENGINEERED_DATA_PATH.exists() else pd.DataFrame()
)


def clean_input(payload):
    cleaned = dict(DEFAULT_INPUT)
    cleaned.update(payload)

    for key in NUMERIC_INPUTS:
        try:
            cleaned[key] = float(cleaned.get(key, DEFAULT_INPUT.get(key, 0)) or 0)
        except (TypeError, ValueError):
            cleaned[key] = float(DEFAULT_INPUT.get(key, 0))

    for key in FLAG_INPUTS:
        cleaned[key] = 1 if str(cleaned.get(key, 0)).lower() in {"1", "true", "yes"} else 0

    for key in ("city", "property_type", "property_subtype", "epc_label"):
        value = str(cleaned.get(key, DEFAULT_INPUT.get(key, "Unknown"))).strip()
        cleaned[key] = value if value else DEFAULT_INPUT.get(key, "Unknown")

    return cleaned


def estimate_price_per_m2(row):
    fallback = 3500.0
    if HISTORICAL_DF.empty or "price_per_m2_calc" not in HISTORICAL_DF.columns:
        return fallback

    postcode_matches = HISTORICAL_DF[HISTORICAL_DF.get("postcode") == row.get("postcode")]
    if len(postcode_matches) >= 5:
        return float(postcode_matches["price_per_m2_calc"].median())

    city_matches = HISTORICAL_DF[HISTORICAL_DF.get("city") == row.get("city")]
    if len(city_matches) >= 5:
        return float(city_matches["price_per_m2_calc"].median())

    return float(HISTORICAL_DF["price_per_m2_calc"].median())


def build_model_row(raw_input):
    row = clean_input(raw_input)

    surface_area = row["surface_area_m2"]
    bedrooms = row["bedrooms"]
    terrace_area = row["terrace_area_m2"]
    garden_area = row["garden_area_m2"]
    year_built = row["year_built"] or datetime.now().year

    row["price_per_m2_calc"] = estimate_price_per_m2(row)
    row["room_density"] = bedrooms / (surface_area + 1)
    row["property_age"] = max(datetime.now().year - year_built, 0)
    row["total_outdoor_area"] = terrace_area + garden_area
    row["outdoor_area_ratio"] = row["total_outdoor_area"] / (surface_area + 1)
    row["living_space_per_room"] = surface_area / (bedrooms + 1)
    row["epc_label_encoded"] = EPC_LABEL_ENCODING.get(row.get("epc_label", "Unknown"), 0)

    model_row = pd.DataFrame([row])
    for column in EXPECTED_FEATURES:
        if column not in model_row.columns:
            model_row[column] = np.nan

    return model_row[EXPECTED_FEATURES], row


def predict_price(payload):
    model_row, normalized = build_model_row(payload)
    prediction = float(MODEL.predict(model_row)[0])
    return {
        "predicted_price": round(prediction),
        "estimated_price_per_m2": round(float(model_row["price_per_m2_calc"].iloc[0])),
        "normalized_input": normalized,
    }


def unique_values(column, fallback):
    if HISTORICAL_DF.empty or column not in HISTORICAL_DF.columns:
        return fallback

    values = HISTORICAL_DF[column].dropna().astype(str).sort_values().unique().tolist()
    return values[:200] if values else fallback


def options_payload():
    postcodes = []
    if not HISTORICAL_DF.empty and "postcode" in HISTORICAL_DF.columns:
        postcodes = (
            HISTORICAL_DF["postcode"]
            .dropna()
            .astype(int)
            .astype(str)
            .sort_values()
            .unique()
            .tolist()
        )

    return {
        "defaults": DEFAULT_INPUT,
        "cities": unique_values("city", ["Antwerp"]),
        "postcodes": postcodes or ["2000"],
        "property_types": unique_values("property_type", ["Apartment"]),
        "property_subtypes": unique_values("property_subtype", ["Apartment"]),
        "epc_labels": ["A", "B", "C", "D", "E", "F", "G", "Unknown"],
    }


class AppHandler(BaseHTTPRequestHandler):
    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, content_type):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = urlparse(self.path).path
        if route == "/":
            self.send_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
        elif route == "/styles.css":
            self.send_file(STATIC_DIR / "styles.css", "text/css; charset=utf-8")
        elif route == "/app.js":
            self.send_file(STATIC_DIR / "app.js", "application/javascript; charset=utf-8")
        elif route == "/api/options":
            self.send_json(options_payload())
        else:
            self.send_json({"error": "Not found"}, status=404)

    def do_POST(self):
        route = urlparse(self.path).path
        if route != "/api/predict":
            self.send_json({"error": "Not found"}, status=404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            self.send_json(predict_price(payload))
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=400)

    def log_message(self, format, *args):
        return


def run(host="127.0.0.1", port=8000):
    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"Serving apartment price app at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()

