import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { isRegistryCode, normalizeRegistryCode } from '../registryCode'

describe('isRegistryCode', () => {
  it('有効なコード形式を受け入れる', () => {
    expect(isRegistryCode('abc-def-ghi')).toBe(true)
    expect(isRegistryCode('clp-mcp-akf')).toBe(true)
    expect(isRegistryCode('zzz-aaa-bbb')).toBe(true)
  })

  it('大文字を拒否する', () => {
    expect(isRegistryCode('ABC-DEF-GHI')).toBe(false)
    expect(isRegistryCode('Abc-def-ghi')).toBe(false)
  })

  it('数字を拒否する', () => {
    expect(isRegistryCode('ab1-def-ghi')).toBe(false)
    expect(isRegistryCode('123-456-789')).toBe(false)
  })

  it('長さが異なるコードを拒否する', () => {
    expect(isRegistryCode('ab-def-ghi')).toBe(false)
    expect(isRegistryCode('abcd-def-ghi')).toBe(false)
    expect(isRegistryCode('abc-de-ghi')).toBe(false)
    expect(isRegistryCode('abc-def')).toBe(false)
    expect(isRegistryCode('abc')).toBe(false)
  })

  it('ハイフンなしを拒否する', () => {
    expect(isRegistryCode('abcdefghi')).toBe(false)
  })

  it('空文字列を拒否する', () => {
    expect(isRegistryCode('')).toBe(false)
  })

  it('URLを拒否する', () => {
    expect(isRegistryCode('https://example.com')).toBe(false)
  })

  it('Feature: butler-assistant-app, Property 1: 正規表現にマッチする文字列は有効', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3}-[a-z]{3}-[a-z]{3}$/),
        (code) => {
          expect(isRegistryCode(code)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('Feature: butler-assistant-app, Property 2: 正規表現にマッチしない文字列は無効', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^[a-z]{3}-[a-z]{3}-[a-z]{3}$/.test(s)),
        (code) => {
          expect(isRegistryCode(code)).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})

describe('normalizeRegistryCode', () => {
  it('ハイフンなし9文字をxxx-xxx-xxx形式に変換する', () => {
    expect(normalizeRegistryCode('abcdefghi')).toBe('abc-def-ghi')
    expect(normalizeRegistryCode('clpmcpakf')).toBe('clp-mcp-akf')
  })

  it('既にハイフン付き形式ならそのまま返す', () => {
    expect(normalizeRegistryCode('abc-def-ghi')).toBe('abc-def-ghi')
  })

  it('大文字を小文字に変換する', () => {
    expect(normalizeRegistryCode('ABCDEFGHI')).toBe('abc-def-ghi')
    expect(normalizeRegistryCode('AbCdEfGhI')).toBe('abc-def-ghi')
  })

  it('数字やスペースなど非アルファベットを除去する', () => {
    expect(normalizeRegistryCode('a1b2c3d4e5f6g7h8i')).toBe('abc-def-ghi')
    expect(normalizeRegistryCode('abc def ghi')).toBe('abc-def-ghi')
  })

  it('9文字未満の場合は部分的に返す', () => {
    expect(normalizeRegistryCode('abc')).toBe('abc')
    expect(normalizeRegistryCode('abcdef')).toBe('abc-def')
    expect(normalizeRegistryCode('ab')).toBe('ab')
  })

  it('空文字列はそのまま返す', () => {
    expect(normalizeRegistryCode('')).toBe('')
  })

  it('9文字を超えるアルファベットは切り捨てる', () => {
    expect(normalizeRegistryCode('abcdefghijklmno')).toBe('abc-def-ghi')
  })

  it('Feature: butler-assistant-app, Property 3: 9文字の小文字アルファベットは正規化後に有効なコードになる', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{9}$/),
        (input) => {
          const result = normalizeRegistryCode(input)
          expect(isRegistryCode(result)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})
