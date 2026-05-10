from __future__ import annotations

import hashlib
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


REPO_ROOT = Path(__file__).resolve().parents[3]
SERVER_SRC = REPO_ROOT / "apps" / "server" / "src"
sys.path.insert(0, str(SERVER_SRC))


from relevo.vector_retrieval import (  # noqa: E402
    DEFAULT_EMBEDDING_BASE_URL,
    DEFAULT_EMBEDDING_MODEL,
    MissingOpenAIAPIKeyError,
    OpenAIEmbeddingClient,
    OpenAIEmbeddingConfig,
    OpenAIEmbeddingError,
    QueryEmbeddingCache,
    chunk_text,
    content_hash,
)


class FakeEmbeddingsEndpoint:
    def __init__(self, response: SimpleNamespace | None = None, error: Exception | None = None) -> None:
        self.response = response or SimpleNamespace(data=[])
        self.error = error
        self.calls: list[dict] = []

    def create(self, **kwargs: object) -> SimpleNamespace:
        self.calls.append(dict(kwargs))
        if self.error is not None:
            raise self.error
        return self.response


class FakeOpenAIClientFactory:
    def __init__(self, endpoint: FakeEmbeddingsEndpoint) -> None:
        self.endpoint = endpoint
        self.calls: list[dict] = []

    def __call__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout: float,
    ) -> SimpleNamespace:
        self.calls.append(
            {
                "api_key": api_key,
                "base_url": base_url,
                "timeout": timeout,
            }
        )
        return SimpleNamespace(embeddings=self.endpoint)


class FakeEmbeddingClient:
    def __init__(self, model: str = "text-embedding-test", dimensions: int | None = None) -> None:
        self.config = SimpleNamespace(model=model, dimensions=dimensions)
        self.calls: list[list[str]] = []

    def embed_texts(self, texts: list[str]) -> list[tuple[float, ...]]:
        self.calls.append(list(texts))
        return [(float(len(self.calls)), 0.25)]


class VectorRetrievalTest(unittest.TestCase):
    def test_content_hash_normalizes_newlines_before_sha256(self) -> None:
        expected = hashlib.sha256("alpha\nbeta".encode("utf-8")).hexdigest()

        self.assertEqual(content_hash("alpha\r\nbeta"), expected)
        self.assertEqual(content_hash("alpha\rbeta"), expected)
        self.assertEqual(content_hash("alpha\nbeta"), expected)

    def test_chunk_text_is_deterministic_and_hashes_each_chunk(self) -> None:
        text = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda."

        first = chunk_text(text, max_chars=24, overlap_chars=6)
        second = chunk_text(text, max_chars=24, overlap_chars=6)

        self.assertEqual(first, second)
        self.assertGreater(len(first), 1)
        self.assertTrue(all(0 < len(chunk) <= 24 for chunk in first))
        for chunk in first:
            self.assertEqual(content_hash(chunk), hashlib.sha256(chunk.encode("utf-8")).hexdigest())
        for previous, current in zip(first, first[1:]):
            self.assertTrue(previous[-6:].strip().split()[-1] in current)

    def test_chunk_text_validates_size_settings(self) -> None:
        self.assertEqual(chunk_text(" \n\t "), [])

        with self.assertRaises(ValueError):
            chunk_text("content", max_chars=0)

        with self.assertRaises(ValueError):
            chunk_text("content", max_chars=10, overlap_chars=10)

    def test_embedding_config_reads_env_with_defaults(self) -> None:
        defaults = OpenAIEmbeddingConfig.from_env({})
        self.assertEqual(defaults.api_key, None)
        self.assertEqual(defaults.model, DEFAULT_EMBEDDING_MODEL)
        self.assertEqual(defaults.base_url, DEFAULT_EMBEDDING_BASE_URL)
        self.assertEqual(defaults.timeout_seconds, 10.0)
        self.assertEqual(defaults.dimensions, None)

        config = OpenAIEmbeddingConfig.from_env(
            {
                "OPENAI_API_KEY": "  sk-test  ",
                "OPENAI_EMBEDDING_MODEL": "text-embedding-3-large",
                "OPENAI_EMBEDDING_BASE_URL": "https://proxy.test/v1/",
                "OPENAI_EMBEDDING_TIMEOUT_SECONDS": "2.5",
                "OPENAI_EMBEDDING_DIMENSIONS": "256",
            }
        )

        self.assertEqual(config.api_key, "sk-test")
        self.assertEqual(config.model, "text-embedding-3-large")
        self.assertEqual(config.base_url, "https://proxy.test/v1")
        self.assertEqual(config.timeout_seconds, 2.5)
        self.assertEqual(config.dimensions, 256)

    def test_openai_embedding_client_posts_payload_and_sorts_response_by_index(self) -> None:
        endpoint = FakeEmbeddingsEndpoint(
            response=SimpleNamespace(
                data=[
                    SimpleNamespace(index=1, embedding=[3, 4]),
                    SimpleNamespace(index=0, embedding=[1, 2]),
                ]
            )
        )
        factory = FakeOpenAIClientFactory(endpoint)
        client = OpenAIEmbeddingClient(
            OpenAIEmbeddingConfig(
                api_key="sk-test",
                model="text-embedding-unit",
                base_url="https://api.test/v1/",
                timeout_seconds=3.0,
                dimensions=2,
            ),
            client_factory=factory,
        )

        embeddings = client.embed_texts(["hello", "world"])

        self.assertEqual(embeddings, [(1.0, 2.0), (3.0, 4.0)])
        self.assertEqual(
            factory.calls,
            [{"api_key": "sk-test", "base_url": "https://api.test/v1", "timeout": 3.0}],
        )
        self.assertEqual(
            endpoint.calls,
            [
                {
                    "model": "text-embedding-unit",
                    "input": ["hello", "world"],
                    "dimensions": 2,
                    "encoding_format": "float",
                }
            ],
        )

    def test_openai_embedding_client_omits_dimensions_when_unset(self) -> None:
        endpoint = FakeEmbeddingsEndpoint()
        client = OpenAIEmbeddingClient(
            OpenAIEmbeddingConfig(api_key="sk-test", dimensions=None),
            client_factory=FakeOpenAIClientFactory(endpoint),
        )

        client.embed_texts(["hello"])

        self.assertEqual(
            endpoint.calls[0],
            {
                "model": DEFAULT_EMBEDDING_MODEL,
                "input": ["hello"],
                "encoding_format": "float",
            },
        )

    def test_openai_embedding_client_requires_api_key_before_transport(self) -> None:
        endpoint = FakeEmbeddingsEndpoint()
        client = OpenAIEmbeddingClient(
            OpenAIEmbeddingConfig(api_key=None),
            client_factory=FakeOpenAIClientFactory(endpoint),
        )

        self.assertEqual(client.embed_texts([]), [])
        with self.assertRaises(MissingOpenAIAPIKeyError):
            client.embed_texts(["hello"])
        self.assertEqual(endpoint.calls, [])

    def test_openai_embedding_client_raises_sanitized_api_errors(self) -> None:
        endpoint = FakeEmbeddingsEndpoint(error=RuntimeError("HTTP 429: rate limit exceeded for sk-secret"))
        client = OpenAIEmbeddingClient(
            OpenAIEmbeddingConfig(api_key="sk-secret"),
            client_factory=FakeOpenAIClientFactory(endpoint),
        )

        with self.assertRaises(OpenAIEmbeddingError) as raised:
            client.embed_texts(["hello"])

        self.assertIn("429", str(raised.exception))
        self.assertIn("rate limit exceeded", str(raised.exception))
        self.assertNotIn("sk-secret", str(raised.exception))

    def test_query_embedding_cache_normalizes_query_and_keys_by_model(self) -> None:
        cache = QueryEmbeddingCache(max_entries=4)
        client = FakeEmbeddingClient(model="model-a")

        first = cache.embed_query("  hello\nworld  ", client)
        second = cache.embed_query("hello world", client)
        other_model = cache.embed_query(
            "hello world",
            FakeEmbeddingClient(model="model-b"),
        )

        self.assertEqual(first, second)
        self.assertEqual(first, (1.0, 0.25))
        self.assertEqual(other_model, (1.0, 0.25))
        self.assertEqual(client.calls, [["hello world"]])

    def test_query_embedding_cache_get_or_create_returns_cached_copy(self) -> None:
        cache = QueryEmbeddingCache(max_size=4)
        config = OpenAIEmbeddingConfig(api_key="sk-test", model="model-a", dimensions=2)
        calls: list[list[str]] = []

        def embed_batch(texts: list[str], _: OpenAIEmbeddingConfig) -> list[list[float]]:
            calls.append(list(texts))
            return [[1.0, 2.0]]

        first = cache.get_or_create(" Hello\nWorld ", config, embed_batch)
        self.assertEqual(first, [1.0, 2.0])
        first.append(99.0)

        second = cache.get_or_create("hello world", config, embed_batch)

        self.assertEqual(second, [1.0, 2.0])
        self.assertEqual(calls, [["hello world"]])

    def test_query_embedding_cache_rejects_blank_queries(self) -> None:
        cache = QueryEmbeddingCache()
        client = FakeEmbeddingClient()

        with self.assertRaises(ValueError):
            cache.embed_query(" \n ", client)
        self.assertEqual(client.calls, [])


if __name__ == "__main__":
    unittest.main()
