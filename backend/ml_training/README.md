# Scanner model

The API never invents predictions. It needs a folder (`MODEL_PATH`) containing:
- `model.keras`: a Keras image classifier
- `model_meta.json`: `{"labels": [...], "input_size": 224, "preprocess": "none" | "mobilenet_v2" | "rescale_0_1", "version": "v1"}`

Class names are mapped to app categories by name (plastic, paper, cardboard, glass, metal, organic, electronic, textile, general; "trash" becomes general; anything else becomes "other"). Predictions below `MIN_CONFIDENCE` are reported as "uncertain".

Options: use a pretrained or public-dataset model whose licence permits your use (check it yourself), or train with `train.py` on a folder-per-class dataset. Only load models you trust. Report what you actually measure: `train.py` writes a validation score from a random split of your own data, which overstates real-world accuracy.

Running it needs `pip install -r requirements-ml.txt`. TensorFlow wants roughly 1 GB or more of RAM; Render's free 512 MB instance won't run it reliably, so use a larger instance. Render's disk is rebuilt on each deploy: host the model as a zip (for example in private object storage with a short-lived URL) and let `scripts/fetch_model.py` download it during the build.
