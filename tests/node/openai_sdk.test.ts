import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";

function resolveApiKey(): string {
  const fromEnv = process.env.WEB2AI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const dbPath = join(homedir(), "Library", "Application Support", "com.web2ai.desktop", "web2ai.db");
  if (existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query<{ key: string }, []>("SELECT key FROM api_keys WHERE is_active = 1 LIMIT 1")
        .get();
      if (row?.key) return row.key;
    } finally {
      db.close();
    }
  }
  throw new Error("WEB2AI_API_KEY environment variable is required to run OpenAI SDK tests.");
}

const baseURL = process.env.WEB2AI_BASE_URL ?? "http://127.0.0.1:8088/v1";
const apiKey = resolveApiKey();

function makeClient(sessionId?: string) {
  return new OpenAI({
    baseURL,
    apiKey,
    defaultHeaders: sessionId ? { "X-Session-Id": sessionId } : undefined,
  });
}

describe("Web2AI OpenAI Node/TS SDK Compatibility", () => {
  test("models.list() exposes only supported DeepSeek models", async () => {
    const client = makeClient();
    const page = await client.models.list();
    const ids = page.data.map((m) => m.id);

    expect(ids).toContain("deepseek:deepseek-chat");
    expect(ids).toContain("deepseek:deepseek-reasoner");
    expect(ids.some((id) => id.startsWith("gemini:") || id.startsWith("metaai:"))).toBe(false);
  });

  test("invalid API key returns OpenAI AuthenticationError (401)", async () => {
    if (process.env.WEB2AI_AUTH_ENABLED !== "1") return;
    const badClient = new OpenAI({ baseURL, apiKey: "sk-invalid-test-key" });
    let caught: unknown;
    try {
      await badClient.chat.completions.create({
        model: "deepseek:deepseek-chat",
        messages: [{ role: "user", content: "hi" }],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OpenAI.AuthenticationError);
    expect((caught as OpenAI.AuthenticationError).status).toBe(401);
  });

  test("invalid response_format returns OpenAI BadRequestError (400)", async () => {
    const client = makeClient();
    let caught: unknown;
    try {
      await client.chat.completions.create({
        model: "deepseek:deepseek-chat",
        messages: [{ role: "user", content: "hi" }],
        // @ts-expect-error testing invalid OpenAI response_format
        response_format: { type: "xml" },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OpenAI.BadRequestError);
    expect((caught as OpenAI.BadRequestError).status).toBe(400);
  });

  test("response_format json_object returns clean parseable JSON object", async () => {
    const client = makeClient(`node-json-obj-${Date.now()}`);
    const res = await client.chat.completions.create({
      model: "deepseek:deepseek-chat",
      messages: [
        {
          role: "user",
          content: "Return JSON describing TypeScript with keys: name (string), typed (boolean).",
        },
      ],
      response_format: { type: "json_object" },
    });

    expect(res.object).toBe("chat.completion");
    expect(res.choices[0]?.finish_reason).toBe("stop");
    const content = res.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();
    expect(Array.isArray(parsed)).toBe(false);
  });

  test("response_format json_schema (strict) enforces nested schema", async () => {
    const client = makeClient(`node-json-schema-${Date.now()}`);
    const res = await client.chat.completions.create({
      model: "deepseek:deepseek-chat",
      messages: [
        {
          role: "user",
          content: "Create an invoice for 2 keyboards at 50 USD each, total 100 USD.",
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "invoice",
          strict: true,
          schema: {
            type: "object",
            properties: {
              currency: { type: "string", enum: ["USD", "VND"] },
              total_amount: { type: "number", minimum: 0 },
              items: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    qty: { type: "integer", minimum: 1 },
                    unit_price: { type: "number", minimum: 0 },
                  },
                  required: ["name", "qty", "unit_price"],
                  additionalProperties: false,
                },
              },
            },
            required: ["currency", "total_amount", "items"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "") as {
      currency: string;
      total_amount: number;
      items: Array<{ name: string; qty: number; unit_price: number }>;
    };
    expect(["USD", "VND"]).toContain(parsed.currency);
    expect(typeof parsed.total_amount).toBe("number");
    expect(parsed.items.length).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(parsed.items[0].qty)).toBe(true);
  });

  test("streaming with response_format json_schema emits valid SSE JSON", async () => {
    const client = makeClient(`node-stream-schema-${Date.now()}`);
    const stream = await client.chat.completions.create({
      model: "deepseek:deepseek-chat",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Describe Tokyo with fields name (string) and country (string).",
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "city_card",
          strict: true,
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              country: { type: "string" },
            },
            required: ["name", "country"],
            additionalProperties: false,
          },
        },
      },
    });

    let merged = "";
    let finishReason: string | null = null;
    for await (const chunk of stream) {
      expect(chunk.object).toBe("chat.completion.chunk");
      const choice = chunk.choices[0];
      if (choice?.delta?.content) merged += choice.delta.content;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }

    expect(finishReason).toBe("stop");
    const parsed = JSON.parse(merged) as { name: string; country: string };
    expect(typeof parsed.name).toBe("string");
    expect(typeof parsed.country).toBe("string");
  });

  test("multi-turn X-Session-Id switches cleanly between JSON and plain text", async () => {
    const sid = `node-multiturn-${Date.now()}`;
    const client = makeClient(sid);

    const turn1 = await client.chat.completions.create({
      model: "deepseek:deepseek-chat",
      messages: [{ role: "user", content: "Remember this secret city name: DaNang." }],
    });
    expect((turn1.choices[0]?.message?.content ?? "").length).toBeGreaterThan(0);

    const turn2 = await client.chat.completions.create({
      model: "deepseek:deepseek-chat",
      messages: [{ role: "user", content: "Return the city I mentioned as JSON." }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "city_ref",
          strict: true,
          schema: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
            additionalProperties: false,
          },
        },
      },
    });
    const parsedTurn2 = JSON.parse(turn2.choices[0]?.message?.content ?? "") as { city: string };
    expect(parsedTurn2.city.toLowerCase()).toContain("danang");

    const turn3 = await client.chat.completions.create({
      model: "deepseek:deepseek-chat",
      messages: [{ role: "user", content: "Now reply in a short normal sentence: Is DaNang in Vietnam?" }],
    });
    const textTurn3 = turn3.choices[0]?.message?.content ?? "";
    expect(textTurn3.length).toBeGreaterThan(0);
    expect(textTurn3.trim().startsWith("{")).toBe(false);
  });

  test("complex 4-level nested json_schema with enums, bounds, and arrays", async () => {
    const client = makeClient(`node-complex-schema-${Date.now()}`);
    const res = await client.chat.completions.create({
      model: "deepseek:deepseek-chat",
      messages: [
        {
          role: "user",
          content: [
            "Generate a Kubernetes deployment plan for service 'billing-api' (tier: core, owner team: Payments, email: pay@acme.dev).",
            "Include 2 environments: staging (2 replicas, 500 cpu_millicores, 512 memory_mb, port 8080 tcp private)",
            "and production (5 replicas, 2000 cpu_millicores, 4096 memory_mb, port 443 tcp public).",
            "Include tags ['payments', 'critical'] and rollback_enabled true with max_surge_percent 25.",
          ].join(" "),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "deployment_plan",
          strict: true,
          schema: {
            type: "object",
            properties: {
              service: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  tier: { type: "string", enum: ["edge", "core", "worker"] },
                  owner: {
                    type: "object",
                    properties: {
                      team: { type: "string" },
                      email: { type: "string" },
                    },
                    required: ["team", "email"],
                    additionalProperties: false,
                  },
                },
                required: ["name", "tier", "owner"],
                additionalProperties: false,
              },
              environments: {
                type: "array",
                minItems: 2,
                items: {
                  type: "object",
                  properties: {
                    env: { type: "string", enum: ["staging", "production"] },
                    replicas: { type: "integer", minimum: 1, maximum: 50 },
                    resources: {
                      type: "object",
                      properties: {
                        cpu_millicores: { type: "integer", minimum: 100 },
                        memory_mb: { type: "integer", minimum: 128 },
                      },
                      required: ["cpu_millicores", "memory_mb"],
                      additionalProperties: false,
                    },
                    ports: {
                      type: "array",
                      minItems: 1,
                      items: {
                        type: "object",
                        properties: {
                          port: { type: "integer", minimum: 1, maximum: 65535 },
                          protocol: { type: "string", enum: ["tcp", "udp"] },
                          public: { type: "boolean" },
                        },
                        required: ["port", "protocol", "public"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["env", "replicas", "resources", "ports"],
                  additionalProperties: false,
                },
              },
              rollback: {
                type: "object",
                properties: {
                  enabled: { type: "boolean" },
                  max_surge_percent: { type: "integer", minimum: 1, maximum: 100 },
                },
                required: ["enabled", "max_surge_percent"],
                additionalProperties: false,
              },
              tags: {
                type: "array",
                minItems: 1,
                items: { type: "string" },
              },
            },
            required: ["service", "environments", "rollback", "tags"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "") as {
      service: { name: string; tier: string; owner: { team: string; email: string } };
      environments: Array<{
        env: string;
        replicas: number;
        resources: { cpu_millicores: number; memory_mb: number };
        ports: Array<{ port: number; protocol: string; public: boolean }>;
      }>;
      rollback: { enabled: boolean; max_surge_percent: number };
      tags: string[];
    };

    expect(parsed.service.name).toBe("billing-api");
    expect(parsed.service.tier).toBe("core");
    expect(parsed.service.owner.email).toBe("pay@acme.dev");
    expect(parsed.environments.length).toBeGreaterThanOrEqual(2);
    expect(parsed.environments.map((e) => e.env)).toContain("production");
    expect(parsed.rollback.enabled).toBe(true);
    expect(parsed.tags.length).toBeGreaterThanOrEqual(1);
  });
});
