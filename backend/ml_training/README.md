# Scanner model

The API never invents predictions. It needs a folder (`MODEL_PATH`) containing:
- `model.onnx`: an ONNX image classifier
- `model_meta.json`: `{"labels": [...], "input_size": 224, "preprocess": "rescale_0_1", "version": "v1"}`

Class names are mapped to app categories by name (plastic, paper, cardboard, glass, metal, organic, electronic, textile, general; "trash" becomes general; anything else becomes "other"). Predictions below `MIN_CONFIDENCE` are reported as "uncertain".

Use a pretrained or public-dataset model whose licence permits your use (check it yourself). Only load models you trust. The older `train.py` script is a separate TensorFlow training example; its Keras output must be exported to ONNX before this API can load it.

Running it needs `pip install -r requirements-ml.txt` in the same Python environment used to run the API. ONNX Runtime runs the small model on CPU. Render's disk is rebuilt on each deploy: host the model and metadata in a zip (for example in private object storage with a short-lived URL) and let `scripts/fetch_model.py` download them during the build.

The development setup uses the 5.81 MB Apache-2.0 [WasteWise YOLOv8n classifier](https://huggingface.co/SriramRokkam/wastewise-garbage-cls). It recognizes battery, biological waste, cardboard, glass, metal, paper, plastic and trash. Its model card reports 94.4% top-1 validation accuracy on its custom dataset; real-world performance may differ, so treat every result as guidance. The weights are ignored by Git and must be downloaded separately on another machine.

From the `backend` directory, download the weights with PowerShell:

```powershell
New-Item -ItemType Directory -Force model | Out-Null
Invoke-WebRequest 'https://huggingface.co/SriramRokkam/wastewise-garbage-cls/resolve/main/wastewise-yolo.onnx' -OutFile model/model.onnx
```

Verify the download with `Get-FileHash model/model.onnx -Algorithm SHA256`; the current SHA-256 is `2B46D491091DBC0ED98A0F1EAEE7FE5739C8FD3EB5BD5935396C3B2712E1F7A6`. The checked-in `model/model_meta.json` supplies the output label order and preprocessing.
