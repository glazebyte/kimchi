import { debuglog } from "node:util"
import type { PiModelConfig } from "../models.js"

const debugOpenAI = debuglog("kimi:openai")

export interface OpenAIProbeOptions {
	timeoutMs?: number
	fetch?: typeof fetch
	throwOnError?: boolean
}

/**
 * Map an OpenAI model ID to a PiModelConfig.
 */
export function mapOpenAIModelToConfig(modelId: string): PiModelConfig {
	const idLower = modelId.toLowerCase()

	// Determine if it is a reasoning model
	let reasoning = false
	if (
		idLower.includes("o1-") ||
		idLower === "o1" ||
		idLower.includes("o3-") ||
		idLower === "o3" ||
		idLower.includes("reasoning")
	) {
		reasoning = true
	}

	// Determine input modalities
	const input: ("text" | "image")[] = ["text"]
	if (idLower.includes("vision") || idLower.includes("gpt-4o") || idLower.includes("o1") || idLower.includes("o3")) {
		input.push("image")
	}

	// Determine context window
	let contextWindow = 128000
	if (idLower.includes("gpt-4o")) {
		contextWindow = 128000
	} else if (idLower.includes("gpt-3.5")) {
		contextWindow = 16384
	} else if (idLower.includes("gpt-4")) {
		contextWindow = 8192
		if (idLower.includes("32k")) {
			contextWindow = 32768
		}
	}

	const maxTokens = Math.min(contextWindow, 8192)

	return {
		id: modelId,
		name: modelId,
		reasoning,
		input,
		contextWindow,
		maxTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		provider: "openai",
		api: "openai-responses",
	}
}

/**
 * Probe an OpenAI-compatible endpoint for available models.
 */
export async function probeOpenAIModels(
	baseUrl: string | undefined,
	apiKey: string,
	options: OpenAIProbeOptions = {},
): Promise<PiModelConfig[]> {
	const host = (baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "")
	const fetchImpl = options.fetch ?? fetch
	const timeoutMs = options.timeoutMs ?? 5000

	try {
		const response = await fetchImpl(`${host}/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
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

		return data.data.map((m) => mapOpenAIModelToConfig(m.id))
	} catch (error) {
		debugOpenAI("probeOpenAIModels failed: %s", error instanceof Error ? error.message : String(error))
		if (options.throwOnError) {
			throw error
		}
		return []
	}
}
