"""Download the model artifact at build time (Render's disk is rebuilt on every deploy).
Set MODEL_URL (a direct link to a .zip of the model folder), MODEL_PATH, and optionally MODEL_SHA256."""
import hashlib
import io
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

url, dest = os.environ.get("MODEL_URL"), os.environ.get("MODEL_PATH")
if not url or not dest:
    sys.exit("MODEL_URL and MODEL_PATH must both be set")
data = urllib.request.urlopen(url, timeout=120).read()  # noqa: S310 (operator-supplied https URL)
expected = os.environ.get("MODEL_SHA256")
if expected and hashlib.sha256(data).hexdigest() != expected.lower():
    sys.exit("Model checksum mismatch: refusing to install it")
Path(dest).mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(io.BytesIO(data)) as z:
    for name in z.namelist():
        if name.startswith("/") or ".." in Path(name).parts:
            sys.exit("Unsafe path in model archive")
    z.extractall(dest)
print(f"Model installed in {dest}")
