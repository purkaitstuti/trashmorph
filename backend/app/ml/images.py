"""Upload validation. Checks the real file content (not the filename or the browser's claimed type)."""
import io
from dataclasses import dataclass

from fastapi import HTTPException, UploadFile
from PIL import Image

ALLOWED = {"JPEG": ("image/jpeg", "jpg"), "PNG": ("image/png", "png"), "WEBP": ("image/webp", "webp")}
MAX_PIXELS = 25_000_000


@dataclass(frozen=True)
class ImageInfo:
    content_type: str
    ext: str
    width: int
    height: int


async def read_limited(file: UploadFile, max_bytes: int) -> bytes:
    """Read the upload but stop as soon as it exceeds the limit."""
    chunks, size = [], 0
    while chunk := await file.read(64 * 1024):
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(413, f"Image is too large. The limit is {max_bytes // (1024 * 1024)} MB.")
        chunks.append(chunk)
    if not size:
        raise HTTPException(422, "The uploaded file is empty.")
    return b"".join(chunks)


def validate_image(data: bytes) -> ImageInfo:
    try:
        with Image.open(io.BytesIO(data)) as im:
            fmt, (w, h) = im.format, im.size
            if fmt not in ALLOWED:
                raise HTTPException(415, "Use a JPG, PNG or WebP image.")
            if w * h > MAX_PIXELS:
                raise HTTPException(422, "That image has too many pixels. Please use a smaller photo.")
            im.verify()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(415, "That file isn't a valid JPG, PNG or WebP image.") from None
    content_type, ext = ALLOWED[fmt]
    return ImageInfo(content_type, ext, w, h)
