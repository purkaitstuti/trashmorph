"""Train a waste classifier by transfer learning (MobileNetV2). Not run by the app; run it yourself where TensorFlow is installed.

Dataset: a folder with one sub-folder per class, each holding images, e.g. data/plastic/*.jpg, data/glass/*.jpg.
You are responsible for the dataset's licence and quality. Usage:
    python ml_training/train.py --data data --out models/waste-v1 --epochs 8
Outputs model.keras, model_meta.json and metrics.json in --out. Point MODEL_PATH at that folder.
"""
import argparse
import json
from pathlib import Path

import tensorflow as tf

ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--epochs", type=int, default=8)
ap.add_argument("--size", type=int, default=224)
ap.add_argument("--version", default="v1")
a = ap.parse_args()

common = dict(validation_split=0.2, seed=42, image_size=(a.size, a.size), batch_size=32)
train = tf.keras.utils.image_dataset_from_directory(a.data, subset="training", **common)
val = tf.keras.utils.image_dataset_from_directory(a.data, subset="validation", **common)
labels = train.class_names
train, val = train.prefetch(tf.data.AUTOTUNE), val.prefetch(tf.data.AUTOTUNE)

base = tf.keras.applications.MobileNetV2(input_shape=(a.size, a.size, 3), include_top=False, weights="imagenet")
base.trainable = False
augment = tf.keras.Sequential([tf.keras.layers.RandomFlip("horizontal"), tf.keras.layers.RandomRotation(0.1), tf.keras.layers.RandomZoom(0.1)])
inputs = tf.keras.Input((a.size, a.size, 3))
x = augment(inputs)
x = tf.keras.applications.mobilenet_v2.preprocess_input(x)   # same scaling the app applies ("mobilenet_v2")
x = base(x, training=False)
x = tf.keras.layers.GlobalAveragePooling2D()(x)
x = tf.keras.layers.Dropout(0.2)(x)
outputs = tf.keras.layers.Dense(len(labels), activation="softmax")(x)
model = tf.keras.Model(inputs, outputs)
model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
model.fit(train, validation_data=val, epochs=a.epochs)
loss, acc = model.evaluate(val)

out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
model.save(out / "model.keras")
# The model already preprocesses internally, so the app must send raw 0-255 pixels: preprocess = "none".
(out / "model_meta.json").write_text(json.dumps({"labels": labels, "input_size": a.size, "preprocess": "none", "version": a.version}, indent=2))
(out / "metrics.json").write_text(json.dumps({"validation_accuracy": float(acc), "validation_loss": float(loss), "note": "Measured on a random 20% split of the same dataset. It is not an independent test and will overstate real-world accuracy."}, indent=2))
print("labels:", labels, "validation accuracy:", acc)
