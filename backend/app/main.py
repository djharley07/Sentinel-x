from app.reviews import router as reviews_router

from fastapi import FastAPI

from app.speech import router as speech_router

app = FastAPI(
    title="SENTINEL X API",
    description="Industrial maintenance intelligence backend.",
    version="0.1.0",
)

app.include_router(speech_router)
app.include_router(reviews_router)


@app.get("/health", tags=["System"])
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "sentinel-x-backend",
        "version": "0.1.0",
    }