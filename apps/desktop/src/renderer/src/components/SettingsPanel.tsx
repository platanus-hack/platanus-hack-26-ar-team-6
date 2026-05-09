import { useState } from 'react'

type DesktopSettings = Awaited<ReturnType<typeof window.api.getSettings>>

type SettingsPanelProps = {
  settings?: DesktopSettings
  onClose: () => void
  onSettingsChange: (settings: DesktopSettings) => void
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function SettingsPanel({ settings, onClose, onSettingsChange }: SettingsPanelProps): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const hasAnthropicApiKey = Boolean(settings?.hasAnthropicApiKey)
  const displayStatus = status ?? (hasAnthropicApiKey ? 'Anthropic API key saved' : null)

  async function handleSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!apiKey.trim()) {
      setStatus('Enter an Anthropic API key')
      return
    }

    setIsSaving(true)
    setStatus(null)

    try {
      const nextSettings = await window.api.saveAnthropicApiKey(apiKey)
      onSettingsChange(nextSettings)
      setApiKey('')
      setStatus('Anthropic API key saved')
    } catch (error) {
      setStatus(`Save failed: ${toErrorMessage(error)}`)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleClear(): Promise<void> {
    setIsSaving(true)
    setStatus(null)

    try {
      const nextSettings = await window.api.clearAnthropicApiKey()
      onSettingsChange(nextSettings)
      setApiKey('')
      setStatus('Anthropic API key cleared')
    } catch (error) {
      setStatus(`Clear failed: ${toErrorMessage(error)}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-panel">
        <div className="settings-panel__header">
          <div>
            <h2 id="settings-title">Settings</h2>
            <p>{hasAnthropicApiKey ? 'Anthropic key configured' : 'Anthropic key missing'}</p>
          </div>
          <button className="settings-panel__close" type="button" onClick={onClose} aria-label="Close settings">
            x
          </button>
        </div>

        <form className="settings-form" onSubmit={handleSave}>
          <label className="settings-form__label" htmlFor="anthropic-api-key">
            Anthropic API key
          </label>
          <input
            id="anthropic-api-key"
            className="settings-form__input"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasAnthropicApiKey ? 'saved key hidden' : 'sk-ant-...'}
            autoComplete="off"
          />

          <div className="settings-form__actions">
            <button className="settings-form__button settings-form__button--primary" type="submit" disabled={isSaving}>
              {isSaving ? 'saving...' : 'save'}
            </button>
            <button
              className="settings-form__button"
              type="button"
              onClick={handleClear}
              disabled={isSaving || !hasAnthropicApiKey}
            >
              clear
            </button>
            <button className="settings-form__button" type="button" onClick={onClose} disabled={isSaving}>
              close
            </button>
          </div>

          {displayStatus && <div className="settings-form__status">{displayStatus}</div>}
        </form>
      </div>
    </div>
  )
}

export default SettingsPanel
