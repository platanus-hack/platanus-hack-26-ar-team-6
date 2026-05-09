import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type StoredApiKey = {
  value: string
  encrypted: boolean
}

type StoredSettings = {
  anthropicApiKey?: StoredApiKey
}

export type DesktopSettingsResponse = {
  hasAnthropicApiKey: boolean
  encryptionAvailable: boolean
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function readStoredSettings(): Promise<StoredSettings> {
  try {
    const text = await readFile(settingsPath(), 'utf-8')
    const data = JSON.parse(text) as StoredSettings
    return data && typeof data === 'object' ? data : {}
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

async function writeStoredSettings(settings: StoredSettings): Promise<void> {
  const filePath = settingsPath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
}

function encryptApiKey(apiKey: string): StoredApiKey {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      value: safeStorage.encryptString(apiKey).toString('base64'),
      encrypted: true
    }
  }

  return {
    value: apiKey,
    encrypted: false
  }
}

function decryptApiKey(storedApiKey: StoredApiKey): string {
  if (!storedApiKey.encrypted) {
    return storedApiKey.value
  }

  try {
    return safeStorage.decryptString(Buffer.from(storedApiKey.value, 'base64'))
  } catch {
    throw new Error('Saved Anthropic API key could not be decrypted. Save it again in settings.')
  }
}

export async function readAnthropicApiKey(): Promise<string | null> {
  const settings = await readStoredSettings()
  if (!settings.anthropicApiKey) {
    return null
  }

  const apiKey = decryptApiKey(settings.anthropicApiKey).trim()
  return apiKey || null
}

export async function getDesktopSettings(): Promise<DesktopSettingsResponse> {
  return {
    hasAnthropicApiKey: Boolean(await readAnthropicApiKey()),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}

export async function saveAnthropicApiKey(apiKey: string): Promise<DesktopSettingsResponse> {
  const trimmedApiKey = apiKey.trim()
  if (!trimmedApiKey) {
    throw new Error('Anthropic API key cannot be empty.')
  }

  const settings = await readStoredSettings()
  settings.anthropicApiKey = encryptApiKey(trimmedApiKey)
  await writeStoredSettings(settings)
  return getDesktopSettings()
}

export async function clearAnthropicApiKey(): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  delete settings.anthropicApiKey
  await writeStoredSettings(settings)
  return getDesktopSettings()
}
