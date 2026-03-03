/**
 * 汎用MCPクライアント
 * Streamable HTTP トランスポートで tools/list と tools/call を実行
 */

/** MCPツール定義 */
export interface MCPToolDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** JSON-RPC 2.0 リクエスト */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

/** JSON-RPC 2.0 通知（id なし） */
interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

/** JSON-RPC 2.0 レスポンス */
interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

let requestId = 0

/**
 * JSON-RPC リクエストを送信し、レスポンスとセッションIDを返す
 */
async function sendJsonRpc(
  serverUrl: string,
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string
): Promise<{ result: unknown; sessionId?: string }> {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: ++requestId,
    method,
    ...(params ? { params } : {}),
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId
  }

  const res = await fetch(serverUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`MCP server returned ${res.status}: ${await res.text()}`)
  }

  const responseSessionId = res.headers.get('mcp-session-id') ?? sessionId
  const contentType = res.headers.get('content-type') ?? ''

  // SSE レスポンスの処理
  if (contentType.includes('text/event-stream')) {
    const text = await res.text()
    const lines = text.split('\n')
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6)) as JsonRpcResponse
        if (data.error) {
          throw new Error(`MCP error ${data.error.code}: ${data.error.message}`)
        }
        return { result: data.result, sessionId: responseSessionId }
      }
    }
    throw new Error('No data in SSE response')
  }

  // JSON レスポンスの処理
  const data = (await res.json()) as JsonRpcResponse
  if (data.error) {
    throw new Error(`MCP error ${data.error.code}: ${data.error.message}`)
  }
  return { result: data.result, sessionId: responseSessionId }
}

/**
 * JSON-RPC 通知を送信（レスポンスなし）
 */
async function sendNotification(
  serverUrl: string,
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string
): Promise<void> {
  const notification: JsonRpcNotification = {
    jsonrpc: '2.0',
    method,
    ...(params ? { params } : {}),
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId
  }

  await fetch(serverUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(5_000),
  })
}

/**
 * MCPサーバーからツール一覧を取得
 *
 * Streamable HTTP プロトコルフロー:
 * 1. initialize → セッションIDをレスポンスヘッダーから取得
 * 2. notifications/initialized 通知送信
 * 3. tools/list でツール一覧取得
 */
export async function listMCPTools(serverUrl: string): Promise<MCPToolDefinition[]> {
  // 1. initialize — セッションIDを取得
  const initResponse = await sendJsonRpc(serverUrl, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'butler-assistant', version: '1.0.0' },
  })
  const sessionId = initResponse.sessionId

  // 2. initialized 通知を送信
  await sendNotification(serverUrl, 'notifications/initialized', undefined, sessionId)

  // 3. tools/list でツール一覧を取得
  const toolsResponse = await sendJsonRpc(serverUrl, 'tools/list', {}, sessionId)
  const result = toolsResponse.result as { tools: MCPToolDefinition[] }
  return result.tools
}

/**
 * MCPサーバーでツールを実行
 */
export async function callMCPTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  // initialize してセッションIDを取得
  const initResponse = await sendJsonRpc(serverUrl, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'butler-assistant', version: '1.0.0' },
  })
  const sessionId = initResponse.sessionId

  await sendNotification(serverUrl, 'notifications/initialized', undefined, sessionId)

  // tools/call を実行
  const callResponse = await sendJsonRpc(serverUrl, 'tools/call', {
    name: toolName,
    arguments: args,
  }, sessionId)

  const result = callResponse.result as { content: Array<{ type: string; text?: string }> }

  // テキストコンテンツを抽出
  const textParts = result.content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
  return textParts.join('\n') || JSON.stringify(result.content)
}
