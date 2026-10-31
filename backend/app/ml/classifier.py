"""ONNX model interface. Loads a CPU model from MODEL_PATH on first use. Never fabricates a prediction:
if the model or its libraries are missing, ModelUnavailable is raised and the API reports it."""
from __future__ import annotations
import json
import logging
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image

from app.core.config import Settings
from app.ml.guidance import guidance_for

log = logging.getLogger("trashmorph.ml")

CATEGORY_ALIASES = {
    "plastic": "plastic", "paper": "paper", "cardboard": "cardboard", "glass": "glass", "metal": "metal",
    "organic": "organic", "biological": "organic", "compost": "organic", "food": "organic", "foodwaste": "organic",
    "electronic": "electronic", "ewaste": "electronic", "electronics": "electronic",
    "battery": "electronic",
    "textile": "textile", "textiles": "textile", "clothes": "textile", "clothing": "textile", "shoes": "textile", "fabric": "textile",
    "trash": "general", "general": "general", "garbage": "general", "residual": "general",
}


class ModelUnavailable(Exception):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason, self.message = reason, message


@dataclass(frozen=True)
class Prediction:
    label: str
    confidence: float


def map_label(label: str) -> str:
    key = re.sub(r"[\s_\-]+", "", label.lower())
    return CATEGORY_ALIASES.get(key, "other")


def build_result(preds: list[Prediction], min_confidence: float) -> dict:
    """Turn raw model output into the API result. Below the confidence threshold the answer is 'uncertain'."""
    top = preds[0]
    uncertain = top.confidence < min_confidence
    category = "uncertain" if uncertain else map_label(top.label)
    action, detail = guidance_for(category)
    return {
        "category": category,
        "confidence": round(top.confidence, 4),
        "is_uncertain": uncertain,
        "top_guess": top.label[:60],
        "suggested_action": action,
        "recycling_guidance": detail,
        "alternatives": [{"label": p.label[:60], "category": map_label(p.label), "confidence": round(p.confidence, 4)} for p in preds[:3]],
    }


def classify_image_regions(clf: OnnxClassifier, data: bytes, min_confidence: float, whole_image_preds: list[Prediction]) -> list[dict]:
    """Classify the whole image and four quadrants as user-reviewable region suggestions.

    This classifier has no object-detection head or bounding boxes. The quadrants are
    therefore scan regions rather than claims that an individual object was detected.
    """
    with Image.open(BytesIO(data)) as source:
        image = source.convert("RGB")
    w, h = image.size
    regions = [("Whole image", (0, 0, w, h), [0.0, 0.0, 1.0, 1.0], whole_image_preds)]
    if w >= 2 and h >= 2:
        mx, my = w // 2, h // 2
        regions.extend([
            ("Top left", (0, 0, mx, my), [0.0, 0.0, 0.5, 0.5], None),
            ("Top right", (mx, 0, w, my), [0.5, 0.0, 0.5, 0.5], None),
            ("Bottom left", (0, my, mx, h), [0.0, 0.5, 0.5, 0.5], None),
            ("Bottom right", (mx, my, w, h), [0.5, 0.5, 0.5, 0.5], None),
        ])
    candidates = []
    for index, (label, box, normalized, predictions) in enumerate(regions):
        if predictions is None:
            crop = image.crop(box)
            encoded = BytesIO()
            crop.save(encoded, format="JPEG", quality=90)
            predictions = clf.predict(encoded.getvalue())
        result = build_result(predictions, min_confidence)
        candidates.append({
            "candidate_id": f"region-{index}", "region_label": label, "bbox": normalized,
            "category": result["category"], "confidence": result["confidence"],
            "is_uncertain": result["is_uncertain"], "top_guess": result["top_guess"],
            "suggested_action": result["suggested_action"],
        })
    return candidates


class OnnxClassifier:
    def __init__(self, session, labels: list[str], size: int, version: str, np):
        self.session, self.labels, self.size, self.version, self.np = session, labels, size, version, np
        self.input_name = session.get_inputs()[0].name

    def predict(self, data: bytes) -> list[Prediction]:
        np = self.np
        with Image.open(BytesIO(data)) as im:
            rgb = im.convert("RGB").resize((self.size, self.size), Image.Resampling.BILINEAR)
            x = np.asarray(rgb, dtype=np.float32) / 255.0
        tensor = np.transpose(x, (2, 0, 1))[None, ...]
        probs = np.asarray(self.session.run(None, {self.input_name: tensor})[0][0], dtype="float64")
        if abs(float(probs.sum()) - 1.0) > 1e-3:
            e = np.exp(probs - probs.max())
            probs = e / e.sum()
        order = np.argsort(probs)[::-1][:3]
        return [Prediction(self.labels[int(i)], float(probs[int(i)])) for i in order]


_cache: dict[str, OnnxClassifier] = {}


def get_classifier(settings: Settings) -> OnnxClassifier:
    key = settings.model_path or str(Path(__file__).resolve().parents[2] / "model")
    if key in _cache:
        return _cache[key]
    folder = Path(key)
    model_file = folder / "model.onnx"
    meta_file = folder / "model_meta.json"
    if not model_file.is_file() or not meta_file.is_file():
        raise ModelUnavailable("not_configured", "The scanner isn't set up yet: model files weren't found. Configure MODEL_PATH or install the local backend/model files.")
    try:
        import numpy as np  # noqa: PLC0415
        import onnxruntime as ort  # noqa: PLC0415
    except ImportError as exc:
        raise ModelUnavailable("ml_dependencies_missing", f"The scanner can't run because {getattr(exc, 'name', None) or 'ONNX Runtime'} isn't installed. Install requirements-ml.txt in the same Python environment running the API.") from None
    try:
        meta = json.loads(meta_file.read_text())
        labels = [str(x) for x in meta["labels"]]
        session = ort.InferenceSession(str(model_file), providers=["CPUExecutionProvider"])
        output_shape = session.get_outputs()[0].shape
        if isinstance(output_shape[-1], int) and len(labels) != output_shape[-1]:
            raise ValueError("labels do not match model outputs")
        clf = OnnxClassifier(session, labels, int(meta.get("input_size", 224)), str(meta.get("version", "unversioned")), np)
    except Exception as exc:  # noqa: BLE001
        log.error("model load failed: %s", type(exc).__name__)
        raise ModelUnavailable("load_failed", "The scanner model couldn't be loaded. Please try again later.") from None
    _cache[key] = clf
    return clf
