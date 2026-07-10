import { debuglog } from "node:util"
import type { PiModelConfig } from "../models.js"

const debug9Router = debuglog("kimi:9router")

export interface NineRouterProbeOptions {
	timeoutMs?: number
	fetch?: typeof fetch
	throwOnError?: boolean
}

/**
 * Map a 9Router model ID to a PiModelConfig.
 */
export function map9RouterModelToConfig(modelId: string): PiModelConfig {
	const idLower = modelId.toLowerCase()

	// Determine if it is a reasoning model
	let reasoning = false
	if (
		idLower.includes("o1-") ||
		idLower === "o1" ||
		idLower.includes("o3-") ||
		idLower === "o3" ||
		idLower.includes("reasoning") ||
		idLower.includes("thinking") ||
		idLower.includes("deepseek-r") ||
		idLower.includes("claude") ||
		idLower.includes("gemini")
	) {
		reasoning = true
	}

	// Determine input modalities
	const input: ("text" | "image")[] = ["text"]
	if (
		idLower.includes("vision") ||
		idLower.includes("gpt-4o") ||
		idLower.includes("claude-3") ||
		idLower.includes("gemini")
	) {
		input.push("image")
	}

	// Determine context window
	let contextWindow = 128000
	if (idLower.includes("gpt-4o")) {
		contextWindow = 128000
	} else if (idLower.includes("gpt-3.5")) {
		contextWindow = 16384
	} else if (idLower.includes("claude-3-5")) {
		contextWindow = 200000
	} else if (idLower.includes("claude-3")) {
		contextWindow = 200000
	} else if (idLower.includes("claude-opus")) {
		contextWindow = 1000000
	} else if (idLower.includes("claude-sonnet")) {
		contextWindow = 1000000
	} else if (idLower.includes("gemini")) {
		contextWindow = 1000000
	} else if (idLower.includes("deepseek")) {
		contextWindow = 64000
	}

	let maxTokens = Math.min(contextWindow, 8192)

	if (idLower.includes("claude-opus")) {
		maxTokens = 1048576
	} else if (idLower.includes("claude-sonnet")) {
		maxTokens = 1048576
	} else if (idLower.includes("gemini")) {
		maxTokens = 64000
	}

	return {
		id: modelId,
		name: modelId,
		reasoning,
		input,
		contextWindow,
		maxTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		provider: "9router",
		api: "openai-responses",
	}
}

/**
 * Probe a 9Router endpoint for available models.
 */
export async function probe9RouterModels(
	baseUrl: string | undefined,
	apiKey: string | undefined,
	options: NineRouterProbeOptions = {},
): Promise<PiModelConfig[]> {
	const host = (baseUrl?.trim() || "http://localhost:20128/v1").replace(/\/+$/, "")
	const fetchImpl = options.fetch ?? fetch
	const timeoutMs = options.timeoutMs ?? 5000

	try {
		const headers: Record<string, string> = {
			Accept: "application/json",
		}
		if (apiKey && apiKey.trim().length > 0) {
			headers.Authorization = `Bearer ${apiKey}`
		}

		const response = await fetchImpl(`${host}/models`, {
			method: "GET",
			headers,
			signal: AbortSignal.timeout(timeoutMs),
		})

		if (!response.ok) {
			const bodyText = await response.text().catch(() => "")
			throw new Error(`HTTP error ${response.status}: ${response.statusText || bodyText || "unknown error"}`)
		}

		const data = (await response.json()) as { data?: { id: string }[] }
		if (!data || !Array.isArray(data.data)) {
			throw new Error("Invalid response format: expected a 'data' array of models.")
		}

		return data.data.map((m) => map9RouterModelToConfig(m.id))
	} catch (error) {
		debug9Router("probe9RouterModels failed: %s", error instanceof Error ? error.message : String(error))
		if (options.throwOnError) {
			throw error
		}
		return []
	}
}
