import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import providerSettingsExtension from "./provider-settings.js"

// Mock the integrations
const mockProbeOpenAI = vi.fn()
const mockProbeClaude = vi.fn()
const mockProbe9Router = vi.fn()

vi.mock("../integrations/openai.js", () => ({
	probeOpenAIModels: (...args: unknown[]) => mockProbeOpenAI(...args),
}))

vi.mock("../integrations/claude.js", () => ({
	probeClaudeModels: (...args: unknown[]) => mockProbeClaude(...args),
}))

vi.mock("../integrations/9router.js", () => ({
	probe9RouterModels: (...args: unknown[]) => mockProbe9Router(...args),
}))

// Mock syncProviderModels
const mockSyncProviderModels = vi.fn()
vi.mock("../models.js", () => ({
	syncProviderModels: (...args: unknown[]) => mockSyncProviderModels(...args),
}))

// Mock fs functions that are used
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>()
	return {
		...actual,
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(() => "{}"),
		writeFileSync: vi.fn(),
	}
})

// Mock getAgentDir
vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => "/mock/agent/dir",
}))

interface RegisteredCmd {
	name: string
	config: {
		description?: string
		handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>
	}
}

describe("provider-settings extension", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		process.env.KIMCHI_CODING_AGENT_DIR = "/mock/agent/dir"
	})

	afterEach(() => {
		// biome-ignore lint/performance/noDelete: cleaning up env var
		delete process.env.KIMCHI_CODING_AGENT_DIR
	})

	it("registers a /provider command", () => {
		const registered: RegisteredCmd[] = []
		const pi = {
			registerCommand: (name: string, config: RegisteredCmd["config"]) => {
				registered.push({ name, config })
			},
		} as unknown as ExtensionAPI

		providerSettingsExtension(pi)

		expect(registered).toHaveLength(1)
		expect(registered[0].name).toBe("provider")
		expect(registered[0].config.description).toBe("Configure LLM providers (API keys and base URLs)")
	})

	it("allows updating credentials for OpenAI", async () => {
		const registered: Record<string, RegisteredCmd["config"]> = {}
		const pi = {
			registerCommand: (name: string, config: RegisteredCmd["config"]) => {
				registered[name] = config
			},
		} as unknown as ExtensionAPI

		providerSettingsExtension(pi)

		const ui = {
			select: vi
				.fn()
				.mockResolvedValueOnce("1. Configure OpenAI") // Choose OpenAI
				.mockResolvedValueOnce("Update credentials") // Choose Action
				.mockResolvedValueOnce("4. Back"), // Break main loop
			input: vi
				.fn()
				.mockResolvedValueOnce("sk-openai-key") // API key
				.mockResolvedValueOnce("https://custom.openai.com"), // Base URL
			notify: vi.fn(),
		}

		const ctx = {
			mode: "tui",
			ui,
			modelRegistry: {
				refresh: vi.fn(),
			},
		} as unknown as ExtensionCommandContext

		mockProbeOpenAI.mockResolvedValueOnce([{ id: "gpt-4o", name: "GPT-4o" }])

		await registered.provider.handler("", ctx)

		expect(mockProbeOpenAI).toHaveBeenCalledWith("https://custom.openai.com", "sk-openai-key", { throwOnError: true })
		expect(mockSyncProviderModels).toHaveBeenCalledWith(
			"/mock/agent/dir/models.json",
			"openai",
			[{ id: "gpt-4o", name: "GPT-4o" }],
			{
				api: "openai-responses",
				baseUrl: "https://custom.openai.com",
				apiKey: "sk-openai-key",
			},
		)
		expect(ctx.modelRegistry?.refresh).toHaveBeenCalled()
		expect(ui.notify).toHaveBeenCalledWith("Successfully configured OpenAI with 1 models!", "info")
	})

	it("allows updating credentials for Anthropic Claude", async () => {
		const registered: Record<string, RegisteredCmd["config"]> = {}
		const pi = {
			registerCommand: (name: string, config: RegisteredCmd["config"]) => {
				registered[name] = config
			},
		} as unknown as ExtensionAPI

		providerSettingsExtension(pi)

		const ui = {
			select: vi
				.fn()
				.mockResolvedValueOnce("2. Configure Anthropic Claude")
				.mockResolvedValueOnce("Update credentials")
				.mockResolvedValueOnce("4. Back"),
			input: vi.fn().mockResolvedValueOnce("sk-ant-key").mockResolvedValueOnce(""),
			notify: vi.fn(),
		}

		const ctx = {
			mode: "tui",
			ui,
			modelRegistry: {
				refresh: vi.fn(),
			},
		} as unknown as ExtensionCommandContext

		mockProbeClaude.mockResolvedValueOnce([{ id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" }])

		await registered.provider.handler("", ctx)

		expect(mockProbeClaude).toHaveBeenCalledWith(undefined, "sk-ant-key", { throwOnError: true })
		expect(mockSyncProviderModels).toHaveBeenCalledWith(
			"/mock/agent/dir/models.json",
			"anthropic",
			[{ id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" }],
			{
				api: "anthropic-messages",
				baseUrl: undefined,
				apiKey: "sk-ant-key",
			},
		)
		expect(ctx.modelRegistry?.refresh).toHaveBeenCalled()
		expect(ui.notify).toHaveBeenCalledWith("Successfully configured Anthropic Claude with 1 models!", "info")
	})

	it("allows updating credentials for 9Router", async () => {
		const registered: Record<string, RegisteredCmd["config"]> = {}
		const pi = {
			registerCommand: (name: string, config: RegisteredCmd["config"]) => {
				registered[name] = config
			},
		} as unknown as ExtensionAPI

		providerSettingsExtension(pi)

		const ui = {
			select: vi
				.fn()
				.mockResolvedValueOnce("3. Configure 9Router")
				.mockResolvedValueOnce("Update credentials")
				.mockResolvedValueOnce("4. Back"),
			input: vi.fn().mockResolvedValueOnce("test-9router-key").mockResolvedValueOnce("https://9router.com/api"),
			notify: vi.fn(),
		}

		const ctx = {
			mode: "tui",
			ui,
			modelRegistry: {
				refresh: vi.fn(),
			},
		} as unknown as ExtensionCommandContext

		mockProbe9Router.mockResolvedValueOnce([{ id: "meta-llama/llama-3-70b-instruct", name: "Llama 3 70B" }])

		await registered.provider.handler("", ctx)

		expect(mockProbe9Router).toHaveBeenCalledWith("https://9router.com/api", "test-9router-key", { throwOnError: true })
		expect(mockSyncProviderModels).toHaveBeenCalledWith(
			"/mock/agent/dir/models.json",
			"9router",
			[{ id: "meta-llama/llama-3-70b-instruct", name: "Llama 3 70B" }],
			{
				api: "openai-responses",
				baseUrl: "https://9router.com/api",
				apiKey: "test-9router-key",
			},
		)
		expect(ctx.modelRegistry?.refresh).toHaveBeenCalled()
		expect(ui.notify).toHaveBeenCalledWith("Successfully configured 9Router with 1 models!", "info")
	})

	it("handles validation failure during probe", async () => {
		const registered: Record<string, RegisteredCmd["config"]> = {}
		const pi = {
			registerCommand: (name: string, config: RegisteredCmd["config"]) => {
				registered[name] = config
			},
		} as unknown as ExtensionAPI

		providerSettingsExtension(pi)

		const ui = {
			select: vi
				.fn()
				.mockResolvedValueOnce("1. Configure OpenAI")
				.mockResolvedValueOnce("Update credentials")
				.mockResolvedValueOnce("4. Back"),
			input: vi.fn().mockResolvedValueOnce("bad-key").mockResolvedValueOnce(""),
			notify: vi.fn(),
		}

		const ctx = {
			mode: "tui",
			ui,
			modelRegistry: {
				refresh: vi.fn(),
			},
		} as unknown as ExtensionCommandContext

		mockProbeOpenAI.mockRejectedValueOnce(new Error("Invalid API key"))

		await registered.provider.handler("", ctx)

		expect(mockProbeOpenAI).toHaveBeenCalledWith(undefined, "bad-key", { throwOnError: true })
		expect(mockSyncProviderModels).not.toHaveBeenCalled()
		expect(ui.notify).toHaveBeenCalledWith("Failed to configure OpenAI: Invalid API key", "error")
	})

	it("allows disabling/clearing a provider", async () => {
		const registered: Record<string, RegisteredCmd["config"]> = {}
		const pi = {
			registerCommand: (name: string, config: RegisteredCmd["config"]) => {
				registered[name] = config
			},
		} as unknown as ExtensionAPI

		providerSettingsExtension(pi)

		const ui = {
			select: vi
				.fn()
				.mockResolvedValueOnce("1. Configure OpenAI")
				.mockResolvedValueOnce("Disable/Clear provider")
				.mockResolvedValueOnce("4. Back"),
			notify: vi.fn(),
		}

		const ctx = {
			mode: "tui",
			ui,
			modelRegistry: {
				refresh: vi.fn(),
			},
		} as unknown as ExtensionCommandContext

		// Mock file existence and read
		const fs = await import("node:fs")
		vi.mocked(fs.existsSync).mockReturnValueOnce(true)
		vi.mocked(fs.readFileSync).mockReturnValueOnce(
			JSON.stringify({
				providers: {
					openai: { apiKey: "old-key" },
				},
			}),
		)

		await registered.provider.handler("", ctx)

		expect(fs.writeFileSync).toHaveBeenCalledWith(
			"/mock/agent/dir/models.json",
			expect.stringContaining('"providers": {}'),
			"utf-8",
		)
		expect(ctx.modelRegistry?.refresh).toHaveBeenCalled()
		expect(ui.notify).toHaveBeenCalledWith("Successfully cleared configuration for OpenAI.", "info")
	})
})
