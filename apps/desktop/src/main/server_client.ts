export type RequestContextRequest = {
  target_user_id: string
  question: string
}

export type RetrievedContextEntry = {
  id: string
  kind: string
  content: string
  metadata: Record<string, unknown>
  created_at: unknown
  user_id?: string
}

export type RequestContextResponse = {
  answer: string
  source_user_ids: string[]
  source_context_entry_ids?: string[]
  target_user_id?: string
  context_entry_id?: string
  retrieved_context_entries?: RetrievedContextEntry[]
}

export type ServerClientConfig = {
  baseUrl: string
  authToken: string
}

export class ServerClient {
  constructor(private readonly config: ServerClientConfig) {}

  async requestContext(req: RequestContextRequest): Promise<RequestContextResponse> {
    const normalizedBaseUrl = this.config.baseUrl.replace(/\/+$/, '')
    const response = await fetch(`${normalizedBaseUrl}/request-context`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req)
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`request-context failed: ${response.status} ${text}`)
    }

    return (await response.json()) as RequestContextResponse
  }
}
