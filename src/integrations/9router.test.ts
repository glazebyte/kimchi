import { describe, expect, it, vi } from "vitest"
import { estimateContextTokens } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js"
import { map9RouterModelToConfig, probe9RouterModels } from "./9router.js"

function makeFetchMock(responder: (url: string, init?: RequestInit) => unknown): typeof fetch {
	return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const urlStr = typeof url === "string" ? url : url.toString()
		const result = responder(urlStr, init)
		if (result) return result as Response
		return new Response("not found", { status: 404 })
	}) as unknown as typeof fetch
}

describe("9Router Integration Discovery", () => {
	it("maps 9Router models to config correctly", () => {
		const model = map9RouterModelToConfig("anthropic/claude-3-5-sonnet")
		expect(model.id).toBe("anthropic/claude-3-5-sonnet")
		expect(model.reasoning).toBe(true)
		expect(model.input).toContain("image")
		expect(model.contextWindow).toBe(200000)
		expect(model.provider).toBe("9router")
		expect(model.api).toBe("openai-responses")
	})

	it("probes models from endpoint with bearer auth if provided", async () => {
		const mockResponse = {
			data: [{ id: "openai/gpt-4o" }],
		}

		const fetchImpl = makeFetchMock((url, init) => {
			expect(url).toBe("http://localhost:20128/v1/models")
			expect(init?.headers).toMatchObject({
				Authorization: "Bearer test-9router-key",
			})
			return {
				ok: true,
				json: async () => mockResponse,
			}
		})

		const models = await probe9RouterModels(undefined, "test-9router-key", { fetch: fetchImpl })
		expect(models).toHaveLength(1)
		expect(models[0].id).toBe("openai/gpt-4o")
		expect(models[0].provider).toBe("9router")
	})

	it("probes models from endpoint without bearer auth if apiKey is not provided", async () => {
		const mockResponse = {
			data: [{ id: "openai/gpt-4o" }],
		}

		const fetchImpl = makeFetchMock((url, init) => {
			expect(url).toBe("http://localhost:20128/v1/models")
			expect(init?.headers).not.toHaveProperty("Authorization")
			return {
				ok: true,
				json: async () => mockResponse,
			}
		})

		const models = await probe9RouterModels(undefined, undefined, { fetch: fetchImpl })
		expect(models).toHaveLength(1)
	})

	it("returns empty list on failure when throwOnError=false", async () => {
		const fetchImpl = makeFetchMock(() => {
			throw new Error("connection failure")
		})

		const models = await probe9RouterModels("http://localhost:20128/v1", "test-key", {
			fetch: fetchImpl,
			throwOnError: false,
		})
		expect(models).toEqual([])
	})

	it("throws on error when throwOnError=true", async () => {
		const fetchImpl = makeFetchMock(() => {
			return {
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				text: async () => "Error message",
			}
		})

		await expect(probe9RouterModels(undefined, "key", { fetch: fetchImpl, throwOnError: true })).rejects.toThrow(
			"HTTP error 500",
		)
	})
})

describe("9Router Context Usage Heuristic (Patched)", () => {
	it("uses character estimation when usage tokens are missing or zero", () => {
		const messages: Record<string, unknown>[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Hello world" }],
				timestamp: Date.now(),
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Hi there" }],
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			},
		]

		const result = estimateContextTokens(messages as unknown as Parameters<typeof estimateContextTokens>[0])
		// Total characters: "Hello world" (11) + "Hi there" (8) = 19
		// 11/4 = 3 + 8/4 = 2 => 5 tokens estimated.
		expect(result.tokens).toBeGreaterThan(0)
		expect(result.usageTokens).toBe(0)
	})

	it("uses provider usage when assistant returns valid non-zero tokens", () => {
		const messages: Record<string, unknown>[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Hello world" }],
				timestamp: Date.now(),
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Hi there" }],
				usage: {
					input: 10,
					output: 5,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 15,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			},
		]

		const result = estimateContextTokens(messages as unknown as Parameters<typeof estimateContextTokens>[0])
		expect(result.tokens).toBe(15)
		expect(result.usageTokens).toBe(15)
	})
})
