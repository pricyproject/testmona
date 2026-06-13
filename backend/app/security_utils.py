"""Security utilities for file validation, rate limiting, and CSRF protection."""
from fastapi import HTTPException, UploadFile, Request
from typing import Optional
import os


# File size limits (in bytes)
MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5MB
MAX_CSV_IMPORT_SIZE = 10 * 1024 * 1024  # 10MB
MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024  # 10MB


async def validate_file_size(
    file: UploadFile,
    max_size: int,
    size_name: str = "file"
) -> bytes:
    """
    Validate file size before processing.

    Args:
        file: UploadFile object
        max_size: Maximum allowed size in bytes
        size_name: Name of the size limit for error messages

    Returns:
        The validated file content as bytes

    Raises:
        HTTPException: If file size exceeds limit
    """
    # Read file content to get actual size
    content = await file.read()
    file_size = len(content)

    # Reset file pointer for subsequent reads
    await file.seek(0)

    if file_size > max_size:
        max_size_mb = max_size / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"{size_name} size must not exceed {max_size_mb:.1f}MB"
        )

    return content


def validate_file_type(
    file: UploadFile,
    allowed_types: list[str],
    type_name: str = "file"
) -> None:
    """
    Validate file content type.
    
    Args:
        file: UploadFile object
        allowed_types: List of allowed MIME types
        type_name: Name of the file type for error messages
        
    Raises:
        HTTPException: If file type is not allowed
    """
    if not file.content_type or file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"{type_name} must be one of: {', '.join(allowed_types)}"
        )


def validate_file_extension(
    filename: str,
    allowed_extensions: list[str],
    type_name: str = "file"
) -> None:
    """
    Validate file extension.
    
    Args:
        filename: Name of the file
        allowed_extensions: List of allowed extensions (e.g., ['.csv', '.png'])
        type_name: Name of the file type for error messages
        
    Raises:
        HTTPException: If file extension is not allowed
    """
    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    
    file_ext = os.path.splitext(filename)[1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"{type_name} must have one of these extensions: {', '.join(allowed_extensions)}"
        )
