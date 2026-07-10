import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { getAgentDir } from "@earendil-works/pi-coding-agent"
import { probe9RouterModels } from "../integrations/9router.js"
import { probeClaudeModels } from "../integrations/claude.js"
import { probeOpenAIModels } from "../integrations/openai.js"
import { type PiModelConfig, syncProviderModels } from "../models.js"
import { numberedChoices, stripChoiceNumber } from "./permissions/select-utils.js"

export default function providerSettingsExtension(pi: ExtensionAPI) {
	pi.registerCommand("provider", {
		description: "Configure LLM providers (API keys and base URLs)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return
			const ui = ctx.ui

			while (true) {
				const choices = numberedChoices(["Configure OpenAI", "Configure Anthropic Claude", "Configure 9Router", "Back"])
				const selected = await ui.select("Select a provider to configure", choices)
				if (!selected) return
				const providerName = stripChoiceNumber(selected)
				if (providerName === "Back") return

				const agentDir = process.env.KIMCHI_CODING_AGENT_DIR ?? getAgentDir()
				const modelsJsonPath = join(agentDir, "models.json")

				// Load current config if present
				let currentConfig: {
					providers?: Record<string, { apiKey?: string; baseUrl?: string }>
				} = {}
				try {
					if (existsSync(modelsJsonPath)) {
						const raw = readFileSync(modelsJsonPath, "utf-8")
						currentConfig = JSON.parse(raw)
					}
				} catch {
					// Ignore
				}

				let providerId = ""
				let cleanProviderName = ""
				if (providerName === "Configure OpenAI") {
					providerId = "openai"
					cleanProviderName = "OpenAI"
				} else if (providerName === "Configure Anthropic Claude") {
					providerId = "anthropic"
					cleanProviderName = "Anthropic Claude"
				} else if (providerName === "Configure 9Router") {
					providerId = "9router"
					cleanProviderName = "9Router"
				}

				if (!providerId) continue

				const existing = currentConfig?.providers?.[providerId] ?? {}
				const existingApiKey = existing.apiKey ?? ""
				const existingBaseUrl = existing.baseUrl ?? ""

				const actionChoices = ["Update credentials", "Disable/Clear provider", "Back"]
				const actionSelected = await ui.select(`Configure ${cleanProviderName}`, actionChoices)
				if (!actionSelected || actionSelected === "Back") continue

				if (actionSelected === "Disable/Clear provider") {
					if (currentConfig.providers && providerId in currentConfig.providers) {
						delete currentConfig.providers[providerId]
						try {
							writeFileSync(modelsJsonPath, JSON.stringify(currentConfig, null, "\t"), "utf-8")
							ctx.modelRegistry?.refresh()
							ui.notify(`Successfully cleared configuration for ${cleanProviderName}.`, "info")
						} catch (err: unknown) {
							const msg = err instanceof Error ? err.message : String(err)
							ui.notify(`Failed to write configuration: ${msg}`, "error")
						}
					} else {
						ui.notify(`${cleanProviderName} is not configured.`, "warning")
					}
					continue
				}

				if (actionSelected === "Update credentials") {
					const keySnippet = existingApiKey ? `${existingApiKey.slice(0, 4)}...${existingApiKey.slice(-4)}` : "not set"
					let apiKeyPrompt = ""
					if (providerId === "openai") {
						apiKeyPrompt = `OpenAI API Key (current: ${keySnippet}, press Enter to keep, or enter new):`
					} else if (providerId === "anthropic") {
						apiKeyPrompt = `Claude API Key (current: ${keySnippet}, press Enter to keep, or enter new):`
					} else {
						apiKeyPrompt = `9Router API Key (current: ${keySnippet}, press Enter to keep, or enter new):`
					}

					const apiKeyInput = await ui.input(apiKeyPrompt)
					if (apiKeyInput === undefined) continue
					const apiKey = apiKeyInput.trim() ? apiKeyInput.trim() : existingApiKey

					if (!apiKey) {
						ui.notify("API Key is required.", "error")
						continue
					}

					const urlDisplay = existingBaseUrl || "default"
					const baseUrlInput = await ui.input(
						`${cleanProviderName} Base URL (current: ${urlDisplay}, press Enter to keep, or enter new):`,
					)
					if (baseUrlInput === undefined) continue
					const baseUrl = baseUrlInput.trim() ? baseUrlInput.trim() : existingBaseUrl

					ui.notify(`Probing ${cleanProviderName} endpoint...`, "info")
					try {
						let models: PiModelConfig[] = []
						if (providerId === "openai") {
							models = await probeOpenAIModels(baseUrl || undefined, apiKey, { throwOnError: true })
						} else if (providerId === "anthropic") {
							models = await probeClaudeModels(baseUrl || undefined, apiKey, { throwOnError: true })
						} else if (providerId === "9router") {
							models = await probe9RouterModels(baseUrl || undefined, apiKey || undefined, { throwOnError: true })
						}

						if (models.length === 0) {
							ui.notify(`${cleanProviderName} probing succeeded but returned no models.`, "warning")
						} else {
							syncProviderModels(modelsJsonPath, providerId, models, {
								api: providerId === "anthropic" ? "anthropic-messages" : "openai-responses",
								baseUrl: baseUrl || undefined,
								apiKey: apiKey || undefined,
							})
							ctx.modelRegistry?.refresh()
							ui.notify(`Successfully configured ${cleanProviderName} with ${models.length} models!`, "info")
						}
					} catch (err: unknown) {
						const msg = err instanceof Error ? err.message : String(err)
						ui.notify(`Failed to configure ${cleanProviderName}: ${msg}`, "error")
					}
				}
			}
		},
	})
}
