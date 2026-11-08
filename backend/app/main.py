from app.redline_alerts import router as redline_alerts_router
from app.pdf_import import router as pdf_import_router
from app.machine_references import router as machine_references_router
from app.machine_admin import router as machine_admin_router
from app.ask_sentinel import router as ask_sentinel_router
from app.equipment_check import router as equipment_check_router
from app.transcript_corrections import router as corrections_router
from app.readback import router as readback_router
from app.analytics import router as analytics_router
from app.worker_machines import router as worker_machines_router
from app.account_admin import router as account_admin_router
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse
from app.work_queue import router as work_queue_router

from app.repairs import router as repairs_router

from app.checklists import router as checklists_router
from app.work_board import router as work_board_router
from app.overview import router as overview_router

from app.redline import router as redline_router

from app.evidence import router as evidence_router

from app.memory import router as memory_router

from app.machine_history import router as machine_history_router

from app.fact_reviews import router as fact_reviews_router

from app.saved_extractions import router as saved_extractions_router

from app.extraction import router as extraction_router

from app.history import router as history_router

from app.reviews import router as reviews_router

from fastapi import FastAPI, Depends
from app.accounts import router as accounts_router
from app.access import AccountMiddleware, authorize

from app.speech import router as speech_router

app = FastAPI(
    dependencies=[Depends(authorize)],
    title="SENTINEL X API",
    description="Industrial maintenance intelligence backend.",
    version="0.1.0",
)

app.add_middleware(AccountMiddleware)
app.include_router(accounts_router)
app.include_router(redline_alerts_router)
app.include_router(machine_admin_router)
app.include_router(machine_references_router)
app.include_router(pdf_import_router)
app.include_router(ask_sentinel_router)
app.include_router(account_admin_router)
app.include_router(worker_machines_router)
app.include_router(analytics_router)
app.include_router(readback_router)
app.include_router(equipment_check_router)
app.include_router(corrections_router)
app.include_router(speech_router)
app.include_router(reviews_router)
app.include_router(history_router)
app.include_router(extraction_router)
app.include_router(saved_extractions_router)
app.include_router(fact_reviews_router)
app.include_router(machine_history_router)
app.include_router(memory_router)
app.include_router(evidence_router)
app.include_router(redline_router)
app.include_router(overview_router)
app.include_router(work_board_router)
app.include_router(checklists_router)
app.include_router(repairs_router)
app.include_router(work_queue_router)


@app.get("/health", tags=["System"])
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "sentinel-x-backend",
        "version": "0.1.0",
    }

@app.exception_handler(RequestValidationError)
async def safe_admin_validation(request, error):
    if request.url.path == '/api/auth/password':
        return JSONResponse({'detail':'Enter your current password and a new password of 12–256 characters.'},status_code=422)
    if request.url.path.startswith('/api/machine-admin'):
        return JSONResponse({'detail':'Check the machine fields. Code, name, department and reason are required; last service date cannot be in the future. Reload saved details before editing an existing machine.'},status_code=422)
    if request.url.path.startswith('/api/account-admin'):
        return JSONResponse({'detail':'Check the account fields. Usernames need 3–64 allowed characters; passwords need 12–256 characters.'},status_code=422)
    return await request_validation_exception_handler(request,error)
