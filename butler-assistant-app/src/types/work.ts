/** QRコードまたはコード入力から生成するMCPペイロード */
export interface MCPQRPayload {
  type: 'mcp'
  code?: string
  serverUrl?: string
  ttlMinutes?: number
  metadata?: Record<string, unknown>
}

/** MCPツール情報 */
export interface MCPToolInfo {
  name: string
  description?: string
}

/** ワーク接続状態 */
export interface WorkConnection {
  themeId: string
  active: boolean
  expiresAt: string
  tools: MCPToolInfo[]
  serverUrl: string
  greeting?: string
  description?: string
}

/** LLMレスポンスに含まれるワーク状態 */
export interface WorkStatus {
  active: boolean
  expiresAt: string
  toolCount: number
}
