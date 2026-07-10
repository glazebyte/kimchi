import { describe, expect, it, vi } from "vitest"
import { mapClaudeModelToConfig, probeClaudeModels } from "./claude.js"

function makeFetchMock(responder: (url: string, init?: RequestInit) => unknown): typeof fetch {
	return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const urlStr = typeof url === "string" ? url : url.toString()
		const result = responder(urlStr, init)
		if (result) return result as Response
		return new Response("not found", { status: 404 })
	}) as unknown as typeof fetch
}

describe("Claude Integration Discovery", () => {
	it("maps Claude models to config correctly", () => {
		const claude35 = mapClaudeModelToConfig("claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet")
		expect(claude35.id).toBe("claude-3-5-sonnet-20241022")
		expect(claude35.name).toBe("Claude 3.5 Sonnet")
		expect(claude35.reasoning).toBe(true)
		expect(claude35.input).toContain("image")
		expect(claude35.contextWindow).toBe(200000)
		expect(claude35.compat).toEqual({
			cacheControlFormat: "anthropic",
			supportsReasoningEffort: false,
		})
	})

	it("probes models from endpoint with anthropic headers", async () => {
		const mockResponse = {
			data: [{ id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet" }],
		}

		const fetchImpl = makeFetchMock((url, init) => {
			expect(url).toBe("https://api.anthropic.com/v1/models")
			expect(init?.headers).toMatchObject({
				"x-api-key": "test-anthropic-key",
				"anthropic-version": "2023-06-01",
			})
			return {
				ok: true,
				json: async () => mockResponse,
			}
		})

		const models = await probeClaudeModels(undefined, "test-anthropic-key", { fetch: fetchImpl })
		expect(models).toHaveLength(1)
		expect(models[0].id).toBe("claude-3-5-sonnet-20241022")
		expect(models[0].name).toBe("Claude 3.5 Sonnet")
		expect(models[0].provider).toBe("anthropic")
		expect(models[0].api).toBe("anthropic-messages")
	})

	it("returns empty list on failure when throwOnError=false", async () => {
		const fetchImpl = makeFetchMock(() => {
			throw new Error("network error")
		})

		const models = await probeClaudeModels("https://api.anthropic.com", "test-key", {
			fetch: fetchImpl,
			throwOnError: false,
		})
		expect(models).toEqual([])
	})

	it("throws on error when throwOnError=true", async () => {
		const fetchImpl = makeFetchMock(() => {
			return {
				ok: false,
				status: 400,
				statusText: "Bad Request",
				text: async () => "Invalid headers",
			}
		})

		await expect(probeClaudeModels(undefined, "bad-key", { fetch: fetchImpl, throwOnError: true })).rejects.toThrow(
			"HTTP error 400",
		)
	})
})
