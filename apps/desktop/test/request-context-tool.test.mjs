import assert from "node:assert/strict";
import test from "node:test";

import { callRequestContext } from "../dist/requestContextTool.js";

test("callRequestContext posts the V1 request-context contract", async () => {
  const calls = [];
  const response = await callRequestContext(
    {
      serverUrl: "https://relevo.example.test/base",
      userId: "user-1",
      authToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init?.method,
          headers: init?.headers,
          body: JSON.parse(String(init?.body)),
        });

        return new Response(
          JSON.stringify({
            answer: "V1 placeholder answer.",
            source_user_ids: ["user-2"],
            citations: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    },
    {
      target: "user-2",
      question: "Which schema should the migration expose?",
    },
  );

  assert.deepEqual(response, {
    answer: "V1 placeholder answer.",
    source_user_ids: ["user-2"],
    citations: [],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://relevo.example.test/request-context");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, {
    target: "user-2",
    question: "Which schema should the migration expose?",
  });
  assert.equal(calls[0].headers["content-type"], "application/json");
  assert.equal(calls[0].headers["x-relevo-user-id"], "user-1");
  assert.equal(calls[0].headers.authorization, "Bearer secret-token");
});

test("callRequestContext supports multi-target requests without auth", async () => {
  const calls = [];
  const response = await callRequestContext(
    {
      serverUrl: "http://localhost:8000",
      userId: "user-1",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          headers: init?.headers,
          body: JSON.parse(String(init?.body)),
        });

        return new Response(
          JSON.stringify({
            answer: "Project and user context are stubbed in V1.",
            source_user_ids: ["user-2"],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    },
    {
      target: ["user-2", "project"],
      question: "What deployment assumption is missing?",
    },
  );

  assert.deepEqual(response, {
    answer: "Project and user context are stubbed in V1.",
    source_user_ids: ["user-2"],
    citations: [],
  });
  assert.deepEqual(calls[0].body.target, ["user-2", "project"]);
  assert.equal("authorization" in calls[0].headers, false);
});

test("callRequestContext surfaces non-2xx server responses", async () => {
  await assert.rejects(
    () =>
      callRequestContext(
        {
          serverUrl: "http://localhost:8000",
          userId: "user-1",
          fetchImpl: async () =>
            new Response("missing endpoint", {
              status: 404,
              statusText: "Not Found",
            }),
        },
        {
          target: "project",
          question: "Anything deployed?",
        },
      ),
    /request_context failed: 404 Not Found: missing endpoint/,
  );
});
