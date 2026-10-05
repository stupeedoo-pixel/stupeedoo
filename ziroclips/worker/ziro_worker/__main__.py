"""`python -m ziro_worker` — run the worker + health API."""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run("ziro_worker.api:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), log_level="warning")
