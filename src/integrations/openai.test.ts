import { describe, expect, it, vi } from "vitest"
import { mapOpenAIModelToConfig, probeOpenAIModels } from "./openai.js"

function makeFetchMock(responder: (url: string, init?: RequestInit) => unknown): typeof fetch {
	return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const urlStr = typeof url === "string" ? url : url.toString()
		const result = responder(urlStr, init)
		if (result) return result as Response
		return new Response("not found", { status: 404 })
	}) as unknown as typeof fetch
}

describe("OpenAI Integration Discovery", () => {
	it("maps standard OpenAI models to config correctly", () => {
		const gpt4o = mapOpenAIModelToConfig("gpt-4o")
		expect(gpt4o.id).toBe("gpt-4o")
		expect(gpt4o.reasoning).toBe(false)
		expect(gpt4o.input).toContain("image")
		expect(gpt4o.contextWindow).toBe(128000)

		const o1 = mapOpenAIModelToConfig("o1-mini")
		expect(o1.id).toBe("o1-mini")
		expect(o1.reasoning).toBe(true)
		expect(o1.input).toContain("image")

		const gpt35 = mapOpenAIModelToConfig("gpt-3.5-turbo")
		expect(gpt35.contextWindow).toBe(16384)
	})

	it("probes models from endpoint and returns parsed configs", async () => {
		const mockResponse = {
			data: [{ id: "gpt-4o" }, { id: "o1" }],
		}

		const fetchImpl = makeFetchMock((url, init) => {
			expect(url).toBe("https://api.openai.com/v1/models")
			expect(init?.headers).toMatchObject({
				Authorization: "Bearer test-key",
			})
			return {
				ok: true,
				json: async () => mockResponse,
			}
		})

		const models = await probeOpenAIModels(undefined, "test-key", { fetch: fetchImpl })
		expect(models).toHaveLength(2)
		expect(models[0].id).toBe("gpt-4o")
		expect(models[0].provider).toBe("openai")
		expect(models[0].api).toBe("openai-responses")
		expect(models[1].id).toBe("o1")
		expect(models[1].reasoning).toBe(true)
	})

	it("returns empty list on failure when throwOnError=false", async () => {
		const fetchImpl = makeFetchMock(() => {
			throw new Error("connection timeout")
		})

		const models = await probeOpenAIModels("https://api.openai.com/v1", "test-key", {
			fetch: fetchImpl,
			throwOnError: false,
		})
		expect(models).toEqual([])
	})

	it("throws on error when throwOnError=true", async () => {
		const fetchImpl = makeFetchMock(() => {
			return {
				ok: false,
				status: 401,
				statusText: "Unauthorized",
				text: async () => "Invalid API key",
			}
		})

		await expect(probeOpenAIModels(undefined, "bad-key", { fetch: fetchImpl, throwOnError: true })).rejects.toThrow(
			"HTTP error 401",
		)
	})
})
