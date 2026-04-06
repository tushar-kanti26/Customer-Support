from datetime import datetime, timezone
import threading


_lock = threading.Lock()
_last_run_at: str | None = None
_last_processed: int = 0
_last_auto_resolved: int = 0
_last_escalated: int = 0
_last_error: str | None = None
_total_runs: int = 0


def record_poll_result(processed: int, auto_resolved: int, escalated: int) -> None:
    global _last_run_at, _last_processed, _last_auto_resolved, _last_escalated, _last_error, _total_runs
    with _lock:
        _last_run_at = datetime.now(timezone.utc).isoformat()
        _last_processed = processed
        _last_auto_resolved = auto_resolved
        _last_escalated = escalated
        _last_error = None
        _total_runs += 1


def record_poll_error(error: Exception) -> None:
    global _last_run_at, _last_error, _total_runs
    with _lock:
        _last_run_at = datetime.now(timezone.utc).isoformat()
        _last_error = f"{error.__class__.__name__}: {error}"
        _total_runs += 1


def get_poll_status() -> dict[str, int | str | None]:
    with _lock:
        return {
            "last_run_at": _last_run_at,
            "last_processed": _last_processed,
            "last_auto_resolved": _last_auto_resolved,
            "last_escalated": _last_escalated,
            "last_error": _last_error,
            "total_runs": _total_runs,
        }
