import logging


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    for noisy in ("httpx", "httpcore", "urllib3", "pinecone", "huggingface_hub"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
