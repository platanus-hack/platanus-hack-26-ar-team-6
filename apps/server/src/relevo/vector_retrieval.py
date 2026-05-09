from __future__ import annotations

import hashlib
import os
from collections import OrderedDict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any


DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_DIMENSIONS = 1536
DEFAULT_EMBEDDING_BASE_URL = "https://api.openai.com/v1"
DEFAULT_EMBEDDING_TIMEOUT_SECONDS = 10.0
DEFAULT_CHUNK_CHARS = 2800
DEFAULT_CHUNK_OVERLAP = 250
QUERY_CACHE_SIZE = 256


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def normalize_text(text: str) -> str:
    return " ".join(normalize_newlines(text).split())


def content_hash(text: str) -> str:
    return hashlib.sha256(normalize_newlines(text).encode("utf-8")).hexdigest()


def chunk_text(
    text: str,
    *,
    max_chars: int = DEFAULT_CHUNK_CHARS,
    overlap_chars: int = DEFAULT_CHUNK_OVERLAP,
) -> list[str]:
    if max_chars <= 0:
        raise ValueError("max_chars must be greater than 0")
    if overlap_chars < 0:
        raise ValueError("overlap_chars must be greater than or equal to 0")
    if overlap_chars >= max_chars:
        raise ValueError("overlap_chars must be smaller than max_chars")

    normalized = normalize_text(text)
    if not normalized:
        return []
    if len(normalized) <= max_chars:
        return [normalized]

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        hard_end = min(len(normalized), start + max_chars)
        end = hard_end
        if hard_end < len(normalized):
            boundary = normalized.rfind(" ", start + max_chars // 2, hard_end)
            if boundary > start:
                end = boundary

        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break

        next_start = max(end - overlap_chars, start + 1)
        while next_start < len(normalized) and normalized[next_start] == " ":
            next_start += 1
        start = next_start

    return chunks


def vector_literal(values: Iterable[float]) -> str:
    return "[" + ",".join(f"{float(value):.9g}" for value in values) + "]"


class OpenAIEmbeddingError(RuntimeError):
    pass


class MissingOpenAIAPIKeyError(OpenAIEmbeddingError):
    pass


@dataclass(frozen=True)
class OpenAIEmbeddingConfig:
    api_key: str | None = None
    model: str = DEFAULT_EMBEDDING_MODEL
    base_url: str = DEFAULT_EMBEDDING_BASE_URL
    timeout_seconds: float = DEFAULT_EMBEDDING_TIMEOUT_SECONDS
    dimensions: int | None = None

    def __post_init__(self) -> None:
        api_key = self.api_key.strip() if self.api_key else None
        model = self.model.strip() or DEFAULT_EMBEDDING_MODEL
        base_url = (self.base_url.strip() or DEFAULT_EMBEDDING_BASE_URL).rstrip("/")
        timeout_seconds = float(self.timeout_seconds)
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than 0")
        if self.dimensions is not None and int(self.dimensions) <= 0:
            raise ValueError("dimensions must be greater than 0")

        object.__setattr__(self, "api_key", api_key)
        object.__setattr__(self, "model", model)
        object.__setattr__(self, "base_url", base_url)
        object.__setattr__(self, "timeout_seconds", timeout_seconds)
        if self.dimensions is not None:
            object.__setattr__(self, "dimensions", int(self.dimensions))

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "OpenAIEmbeddingConfig":
        values = os.environ if env is None else env
        dimensions = _optional_int(
            values.get("OPENAI_EMBEDDING_DIMENSIONS")
            or values.get("EMBEDDING_DIMENSIONS")
        )
        return cls(
            api_key=_optional_str(values.get("OPENAI_API_KEY")),
            model=_optional_str(values.get("OPENAI_EMBEDDING_MODEL"))
            or _optional_str(values.get("EMBEDDING_MODEL"))
            or DEFAULT_EMBEDDING_MODEL,
            base_url=_optional_str(values.get("OPENAI_EMBEDDING_BASE_URL"))
            or DEFAULT_EMBEDDING_BASE_URL,
            timeout_seconds=float(
                _optional_str(values.get("OPENAI_EMBEDDING_TIMEOUT_SECONDS"))
                or DEFAULT_EMBEDDING_TIMEOUT_SECONDS
            ),
            dimensions=dimensions,
        )

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    @property
    def effective_dimensions(self) -> int:
        return self.dimensions or DEFAULT_EMBEDDING_DIMENSIONS


EmbeddingConfig = OpenAIEmbeddingConfig
OpenAIClientFactory = Callable[..., Any]
EmbedBatchFn = Callable[[list[str], EmbeddingConfig], list[Sequence[float]]]


class OpenAIEmbeddingClient:
    def __init__(
        self,
        config: OpenAIEmbeddingConfig | None = None,
        *,
        client_factory: OpenAIClientFactory | None = None,
    ) -> None:
        self.config = config or OpenAIEmbeddingConfig.from_env()
        self._client_factory = client_factory or _default_openai_client_factory
        self._client: Any | None = None

    def embed_texts(self, texts: Sequence[str]) -> list[tuple[float, ...]]:
        inputs = [str(text) for text in texts]
        if not inputs:
            return []
        if not self.config.api_key:
            raise MissingOpenAIAPIKeyError("OPENAI_API_KEY is required for embeddings")

        request: dict[str, Any] = {
            "model": self.config.model,
            "input": inputs,
            "encoding_format": "float",
        }
        if self.config.dimensions is not None:
            request["dimensions"] = self.config.dimensions

        try:
            response = self._client_instance().embeddings.create(**request)
        except Exception as exc:
            message = _sanitize_error(str(exc), self.config.api_key)
            raise OpenAIEmbeddingError(
                f"OpenAI embeddings request failed: {message}"
            ) from exc

        return [_coerce_embedding(item) for item in _ordered_response_data(response)]

    def _client_instance(self) -> Any:
        if self._client is None:
            self._client = self._client_factory(
                api_key=self.config.api_key,
                base_url=self.config.base_url,
                timeout=self.config.timeout_seconds,
            )
        return self._client


class QueryEmbeddingCache:
    def __init__(
        self,
        max_size: int = QUERY_CACHE_SIZE,
        *,
        max_entries: int | None = None,
    ) -> None:
        selected_size = max_entries if max_entries is not None else max_size
        if selected_size <= 0:
            raise ValueError("max_size must be greater than 0")
        self._max_size = selected_size
        self._values: OrderedDict[str, tuple[float, ...]] = OrderedDict()

    def get_or_create(
        self,
        query: str,
        config: EmbeddingConfig,
        embed_batch: EmbedBatchFn,
    ) -> list[float] | None:
        normalized = normalize_text(query).lower()
        if not normalized or not config.enabled:
            return None

        key = self._key(normalized, config.model, config.dimensions)
        cached = self._values.get(key)
        if cached is not None:
            self._values.move_to_end(key)
            return list(cached)

        embeddings = embed_batch([normalized], config)
        if not embeddings:
            return None

        embedding = tuple(float(value) for value in embeddings[0])
        self._remember(key, embedding)
        return list(embedding)

    def embed_query(self, query: str, client: Any) -> tuple[float, ...]:
        normalized = normalize_text(query).lower()
        if not normalized:
            raise ValueError("query must not be blank")

        config = client.config
        key = self._key(normalized, config.model, getattr(config, "dimensions", None))
        cached = self._values.get(key)
        if cached is not None:
            self._values.move_to_end(key)
            return cached

        embeddings = client.embed_texts([normalized])
        if not embeddings:
            raise OpenAIEmbeddingError("OpenAI embeddings response did not include data")
        embedding = tuple(float(value) for value in embeddings[0])
        self._remember(key, embedding)
        return embedding

    def _remember(self, key: str, embedding: tuple[float, ...]) -> None:
        self._values[key] = embedding
        self._values.move_to_end(key)
        if len(self._values) > self._max_size:
            self._values.popitem(last=False)

    @staticmethod
    def _key(query: str, model: str, dimensions: int | None) -> str:
        return f"{model}:{dimensions}:{content_hash(query)}"


def embed_texts_openai(texts: list[str], config: EmbeddingConfig) -> list[list[float]]:
    if not texts or not config.enabled:
        return []
    client = OpenAIEmbeddingClient(config)
    return [list(embedding) for embedding in client.embed_texts(texts)]


def _optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _optional_int(value: str | None) -> int | None:
    stripped = _optional_str(value)
    if stripped is None:
        return None
    return int(stripped)


def _default_openai_client_factory(**kwargs: Any) -> Any:
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise OpenAIEmbeddingError("openai package is required for embeddings") from exc
    return OpenAI(**kwargs)


def _sanitize_error(message: str, api_key: str | None) -> str:
    if api_key:
        return message.replace(api_key, "[redacted]")
    return message


def _ordered_response_data(response: Any) -> list[Any]:
    data = getattr(response, "data", None)
    if data is None and isinstance(response, Mapping):
        data = response.get("data")
    if data is None:
        raise OpenAIEmbeddingError("OpenAI embeddings response did not include data")

    indexed = []
    for fallback_index, item in enumerate(data):
        item_index = _item_value(item, "index")
        index = fallback_index if item_index is None else int(item_index)
        indexed.append((index, item))
    return [item for _, item in sorted(indexed, key=lambda pair: pair[0])]


def _coerce_embedding(item: Any) -> tuple[float, ...]:
    embedding = _item_value(item, "embedding")
    if embedding is None:
        raise OpenAIEmbeddingError("OpenAI embeddings response item is missing embedding")
    return tuple(float(value) for value in embedding)


def _item_value(item: Any, key: str) -> Any:
    if isinstance(item, Mapping):
        return item.get(key)
    return getattr(item, key, None)


QUERY_EMBEDDING_CACHE = QueryEmbeddingCache()
