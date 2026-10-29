import os
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, UploadFile

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

router = APIRouter(prefix="/api/speech", tags=["Speech"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024  # Our local demo limit: 10 MiB
AUDIO_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
}


@router.post("/transcribe")
def transcribe_audio(audio: UploadFile):
    """Transcribe a short recording. The result still needs user review."""
    extension = Path(audio.filename or "").suffix.lower()
    if extension not in AUDIO_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Use WAV, MP3, M4A, OGG, FLAC or AAC audio.",
        )

    audio_bytes = audio.file.read(MAX_AUDIO_BYTES + 1)

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="The audio file is empty.")

    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Use an audio file smaller than 10 MiB.",
        )

    api_key = os.getenv("GNANI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="The backend is missing its Gnani API key.",
        )

    try:
        response = requests.post(
            "https://api.vachana.ai/stt/v3",
            headers={"X-API-Key-ID": api_key},
            files={
                "audio_file": (
                    f"recording{extension}",
                    audio_bytes,
                    AUDIO_TYPES[extension],
                )
            },
            data={
                "model": "prisma-v3.0",
                "language_code": "indic-auto",
            },
            timeout=(10, 60),
            allow_redirects=False,
        )
    except requests.Timeout:
        raise HTTPException(
            status_code=504,
            detail="Gnani timed out. Try again later.",
        ) from None
    except requests.RequestException:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to Gnani.",
        ) from None

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Gnani returned HTTP {response.status_code}.",
        )

    try:
        result = response.json()
    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="Gnani returned an unreadable response.",
        ) from None

    if not isinstance(result, dict) or result.get("success") is not True:
        raise HTTPException(
            status_code=502,
            detail="Gnani did not report a successful transcription.",
        )

    transcript = result.get("transcript")
    if not isinstance(transcript, str) or not transcript.strip():
        raise HTTPException(
            status_code=422,
            detail="No speech was transcribed. Try a clearer recording.",
        )

    return {
        "transcript": transcript,
        "model": result.get("model"),
        "detected_language_code": result.get("detected_language_code"),
        "request_id": result.get("request_id"),
        "verification_status": "pending",
    }