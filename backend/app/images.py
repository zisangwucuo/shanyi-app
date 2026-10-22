from fastapi import HTTPException

MAX_IMAGE_BYTES = 5 * 1024 * 1024


def validate_image_bytes(data, content_type=None):
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "图片须为1字节至5MB")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime, suffix = "image/png", ".png"
    elif data.startswith(b"\xff\xd8\xff"):
        mime, suffix = "image/jpeg", ".jpg"
    elif len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        mime, suffix = "image/webp", ".webp"
    else:
        raise HTTPException(400, "图片实际格式须为 JPG、PNG 或 WEBP")
    if content_type is not None and content_type != mime:
        raise HTTPException(400, "图片声明类型与实际格式不符")
    return suffix
