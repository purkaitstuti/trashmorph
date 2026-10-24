"""Model interface. Loads a Keras model from MODEL_PATH on first use. Never fabricates a prediction:
if the model or its libraries are missing, ModelUnavailable is raised and the API reports it."""
import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings
from app.ml.guidance import guidance_for

log = logging.getLogger("trashmorph.ml")

CATEGORY_ALIASES = {
    "plastic": "plastic", "paper": "paper", "cardboard": "cardboard", "glass": "glass", "metal": "metal",
    "organic": "organic", "biological": "organic", "compost": "organic", "food": "organic", "foodwaste": "organic",
    "electronic": "electronic", "ewaste": "electronic", "electronics": "electronic",
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


class KerasClassifier:
    def __init__(self, model, labels: list[str], size: int, preprocess: str, version: str, np, cv2):
        self.model, self.labels, self.size, self.preprocess, self.version, self.np, self.cv2 = model, labels, size, preprocess, version, np, cv2

    def predict(self, data: bytes) -> list[Prediction]:
        np, cv2 = self.np, self.cv2
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("could not decode image")
        x = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), (self.size, self.size), interpolation=cv2.INTER_AREA).astype("float32")
        if self.preprocess == "mobilenet_v2":
            x = x / 127.5 - 1.0
        elif self.preprocess == "rescale_0_1":
            x = x / 255.0
        probs = self.model.predict(x[None, ...], verbose=0)[0].astype("float64")
        if abs(float(probs.sum()) - 1.0) > 1e-3:  # model outputs logits: apply softmax
            e = np.exp(probs - probs.max())
            probs = e / e.sum()
        order = np.argsort(probs)[::-1][:3]
        return [Prediction(self.labels[int(i)], float(probs[int(i)])) for i in order]


_cache: dict[str, KerasClassifier] = {}


def get_classifier(settings: Settings) -> KerasClassifier:
    key = settings.model_path
    if key in _cache:
        return _cache[key]
    if not key:
        raise ModelUnavailable("not_configured", "The scanner isn't set up yet: no model is configured on the server.")
    folder = Path(key)
    model_file, meta_file = folder / "model.keras", folder / "model_meta.json"
    if not model_file.is_file() or not meta_file.is_file():
        raise ModelUnavailable("not_configured", "The scanner isn't set up yet: the model files weren't found on the server.")
    try:
        import cv2  # noqa: PLC0415
        import numpy as np  # noqa: PLC0415
        import tensorflow as tf  # noqa: PLC0415
    except ImportError:
        raise ModelUnavailable("ml_dependencies_missing", "The scanner can't run on this server because TensorFlow or OpenCV isn't installed.") from None
    try:
        meta = json.loads(meta_file.read_text())
        model = tf.keras.models.load_model(model_file)  # safe_mode stays on: only load models you trust
        labels = [str(x) for x in meta["labels"]]
        if len(labels) != int(model.output_shape[-1]):
            raise ValueError("labels do not match model outputs")
        clf = KerasClassifier(model, labels, int(meta.get("input_size", 224)), meta.get("preprocess", "none"), str(meta.get("version", "unversioned")), np, cv2)
    except Exception as exc:  # noqa: BLE001
        log.error("model load failed: %s", type(exc).__name__)
        raise ModelUnavailable("load_failed", "The scanner model couldn't be loaded. Please try again later.") from None
    _cache[key] = clf
    return clf
