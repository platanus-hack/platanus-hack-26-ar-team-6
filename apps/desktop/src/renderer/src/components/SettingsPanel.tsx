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
  const [isSavingKey, setIsSavingKey] = useState(false)
  const hasAnthropicApiKey = Boolean(settings?.hasAnthropicApiKey)
  const displayStatus = status ?? (hasAnthropicApiKey ? 'Anthropic API key saved' : null)

  async function handleSaveKey(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!apiKey.trim()) {
      setStatus('Enter an Anthropic API key')
      return
    }

    setIsSavingKey(true)
    setStatus(null)

    try {
      const nextSettings = await window.api.saveAnthropicApiKey(apiKey)
      onSettingsChange(nextSettings)
      setApiKey('')
      setStatus('Anthropic API key saved')
    } catch (error) {
      setStatus(`Save failed: ${toErrorMessage(error)}`)
    } finally {
      setIsSavingKey(false)
    }
  }

  async function handleClear(): Promise<void> {
    setIsSavingKey(true)
    setStatus(null)

    try {
      const nextSettings = await window.api.clearAnthropicApiKey()
      onSettingsChange(nextSettings)
      setApiKey('')
      setStatus('Anthropic API key cleared')
    } catch (error) {
      setStatus(`Clear failed: ${toErrorMessage(error)}`)
    } finally {
      setIsSavingKey(false)
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

        <form className="settings-form" onSubmit={handleSaveKey}>
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
            <button className="settings-form__button settings-form__button--primary" type="submit" disabled={isSavingKey}>
              {isSavingKey ? 'saving...' : 'save'}
            </button>
            <button
              className="settings-form__button"
              type="button"
              onClick={handleClear}
              disabled={isSavingKey || !hasAnthropicApiKey}
            >
              clear
            </button>
            <button className="settings-form__button" type="button" onClick={onClose} disabled={isSavingKey}>
              close
            </button>
          </div>
        </form>

        {displayStatus && <div className="settings-form__status settings-form__status--panel">{displayStatus}</div>}
      </div>
    </div>
  )
}

export default SettingsPanel
