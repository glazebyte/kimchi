import { describe, expect, it, vi } from "vitest"
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
