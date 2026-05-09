from __future__ import annotations

import uvicorn

from relevo.config import load_server_config


def main() -> None:
    config = load_server_config()
    uvicorn.run("relevo.main:app", host=config.host, port=config.port)


if __name__ == "__main__":
    main()
