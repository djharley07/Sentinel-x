"""Ephemeral question transcription: no report, recording or database writes."""
from pathlib import Path
import json
import requests
from dotenv import dotenv_values
from fastapi import HTTPException, UploadFile
from app.language_options import request_options

ROOT = Path(__file__).resolve().parents[2]
MAX_AUDIO = 10 * 1024 * 1024
TYPES = {'.wav':'audio/wav', '.mp3':'audio/mpeg', '.m4a':'audio/mp4',
         '.ogg':'audio/ogg', '.flac':'audio/flac', '.aac':'audio/aac'}

def transcribe_question(audio: UploadFile, mode: str):
    extension = Path(audio.filename or '').suffix.lower()
    if extension not in TYPES:
        raise HTTPException(415, 'Use WAV, MP3, M4A, OGG, FLAC or AAC audio.')
    payload = audio.file.read(MAX_AUDIO + 1)
    if not payload:
        raise HTTPException(400, 'The recording is empty.')
    if len(payload) > MAX_AUDIO:
        raise HTTPException(413, 'Use a recording up to 10 MiB.')
    key = (dotenv_values(ROOT / '.env').get('GNANI_API_KEY') or '').strip()
    if not key:
        raise HTTPException(503, 'The backend is missing its Gnani API key.')
    try:
        with requests.post('https://api.vachana.ai/stt/v3',
            headers={'X-API-Key-ID':key},
            files={'audio_file':('question'+extension, payload, TYPES[extension])},
            data={'model':'prisma-v3.0', **request_options(mode)},
            timeout=(10,60), allow_redirects=False, stream=True) as response:
            if response.status_code == 429:
                raise HTTPException(429, 'Gnani is busy. Wait before transcribing again.')
            if response.status_code != 200:
                raise HTTPException(502, 'Gnani could not transcribe this question. Check the backend configuration or try later.')
            content = bytearray()
            for chunk in response.iter_content(16384):
                content.extend(chunk)
                if len(content) > 1024 * 1024:
                    raise HTTPException(502, 'Gnani returned an oversized transcription response.')
    except requests.Timeout:
        raise HTTPException(504, 'Transcription timed out. Wait before trying again; Gnani may have processed it.') from None
    except requests.RequestException:
        raise HTTPException(502, 'Could not connect to Gnani.') from None
    try:
        result = json.loads(content)
    except (ValueError, UnicodeError):
        raise HTTPException(502, 'Gnani returned an unreadable transcription response.') from None
    if not isinstance(result, dict) or result.get('success') is not True:
        raise HTTPException(502, 'Gnani did not report a successful transcription.')
    text = result.get('transcript')
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(422, 'No speech was heard. Try a clearer recording.')
    text = text.strip()
    if len(text) > 1200:
        raise HTTPException(422, 'This question is longer than 1,200 characters. Record a shorter question or type it instead.')
    language = result.get('detected_language_code')
    if language is not None and (not isinstance(language, str) or len(language) > 100):
        raise HTTPException(502, 'Gnani returned an invalid language identifier.')
    return {'transcript':text, 'detected_language_code':language, 'persistence_status':'not_saved'}
