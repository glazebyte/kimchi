import { debuglog } from "node:util"
import type { PiModelConfig } from "../models.js"

const debugClaude = debuglog("kimi:claude")

export interface ClaudeProbeOptions {
	timeoutMs?: number
	fetch?: typeof fetch
	throwOnError?: boolean
}

/**
 * Map a Claude model ID to a PiModelConfig.
 */
export function mapClaudeModelToConfig(modelId: string, displayName?: string): PiModelConfig {
	const idLower = modelId.toLowerCase()

	// Anthropic models are reasoning/planning capable
	const reasoning = true

	// Determine input modalities
	const input: ("text" | "image")[] = ["text"]
	if (
		idLower.includes("claude-3") ||
		idLower.includes("claude-2.1") === false // Claude 3 and 3.5 have vision
	) {
		input.push("image")
	}

	// Determine context window
	let contextWindow = 200000
	if (idLower.includes("claude-instant") || idLower.includes("claude-2.0")) {
		contextWindow = 100000
	}

	const maxTokens = Math.min(contextWindow, 8192)

	return {
		id: modelId,
		name: displayName || modelId,
		reasoning,
		input,
		contextWindow,
		maxTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		provider: "anthropic",
		api: "anthropic-messages",
		compat: {
			cacheControlFormat: "anthropic",
			supportsReasoningEffort: false,
		},
	}
}

/**
 * Probe the Anthropic API endpoint for available Claude models.
 */
export async function probeClaudeModels(
	baseUrl: string | undefined,
	apiKey: string,
	options: ClaudeProbeOptions = {},
): Promise<PiModelConfig[]> {
	const host = (baseUrl?.trim() || "https://api.anthropic.com").replace(/\/+$/, "")
	const fetchImpl = options.fetch ?? fetch
	const timeoutMs = options.timeoutMs ?? 5000

	try {
		const response = await fetchImpl(`${host}/v1/models`, {
			method: "GET",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(timeoutMs),
		})

		if (!response.ok) {
			const bodyText = await response.text().catch(() => "")
			throw new Error(`HTTP error ${response.status}: ${response.statusText || bodyText || "unknown error"}`)
		}

		const data = (await response.json()) as { data?: { id: string; display_name?: string }[] }
		if (!data || !Array.isArray(data.data)) {
			throw new Error("Invalid response format: expected a 'data' array of models.")
		}

		return data.data.map((m) => mapClaudeModelToConfig(m.id, m.display_name))
	} catch (error) {
		debugClaude("probeClaudeModels failed: %s", error instanceof Error ? error.message : String(error))
		if (options.throwOnError) {
			throw error
		}
		return []
	}
}
