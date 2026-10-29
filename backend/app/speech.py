from time import perf_counter

import logging

import psycopg

from app.report_store import save_transcription
logger = logging.getLogger(__name__)
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
    gnani_started = perf_counter()
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
    logger.warning(
        "Gnani response received in %.2f seconds; HTTP %s",
        perf_counter() - gnani_started,
        response.status_code,
    )
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

    model = result.get("model")
    language = result.get("detected_language_code")
    request_id = result.get("request_id")

    if not isinstance(model, str) or not model.strip():
        raise HTTPException(
            status_code=502,
            detail="Gnani did not return a valid model identifier.",
        )

    if language is not None and not isinstance(language, str):
        raise HTTPException(
            status_code=502,
            detail="Gnani returned an invalid language identifier.",
        )

    if request_id is not None and not isinstance(request_id, str):
        raise HTTPException(
            status_code=502,
            detail="Gnani returned an invalid request identifier.",
        )
    save_started = perf_counter()
    try:
        saved = save_transcription(
            audio_bytes=audio_bytes,
            extension=extension,
            transcript=transcript,
            model=model,
            language=language,
            provider_request_id=request_id,
        )
    except (psycopg.Error, OSError, RuntimeError, ValueError) as error:
        # Log the error type without exposing credentials or report content.
        logger.error("Report persistence failed: %s", type(error).__name__)
        raise HTTPException(
            status_code=503,
            detail=(
                "Transcription completed, but report saving could not be "
                "confirmed. Check the backend before submitting again."
            ),
        ) from None
    logger.warning(
        "Report saved in %.2f seconds",
        perf_counter() - save_started,
    )
    return {
        **saved,
        "transcript": transcript,
        "model": model,
        "detected_language_code": language,
        "request_id": request_id,
        "verification_status": "pending",
        "persistence_status": "saved",
    }