import { describe, it, expect, beforeEach, vi } from 'vitest'
import fc from 'fast-check'
import { ModelLoaderImpl } from '../modelLoader'
import { ModelLoadError } from '@/types'

// File オブジェクトのモック
const createMockFile = (name: string, content: string = ''): File => {
  const blob = new Blob([content], { type: 'application/json' })
  return new File([blob], name)
}

describe('ModelLoader', () => {
  let loader: ModelLoaderImpl

  beforeEach(() => {
    loader = new ModelLoaderImpl()
    localStorage.clear()
  })

  describe('validateModelFiles', () => {
    it('空の配列はバリデーションエラーになる', () => {
      const result = loader.validateModelFiles([])

      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.field === 'files')).toBe(true)
    })

    it('model3.jsonがない場合はバリデーションエラーになる', () => {
      const files = [createMockFile('texture.png')]
      const result = loader.validateModelFiles(files)

      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.field === 'modelFile')).toBe(true)
    })

    it('テクスチャがない場合はバリデーションエラーになる', () => {
      const files = [createMockFile('model.model3.json')]
      const result = loader.validateModelFiles(files)

      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.field === 'textures')).toBe(true)
    })

    it('有効なファイルセットは検証を通過する', () => {
      const files = [
        createMockFile('model.model3.json'),
        createMockFile('texture.png'),
      ]
      const result = loader.validateModelFiles(files)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('JPGテクスチャも有効', () => {
      const files = [
        createMockFile('model.model3.json'),
        createMockFile('texture.jpg'),
      ]
      const result = loader.validateModelFiles(files)

      expect(result.isValid).toBe(true)
    })
  })

  describe('loadModel', () => {
    it('有効なファイルセットからモデルを読み込める', async () => {
      const modelJson = JSON.stringify({
        Version: 3,
        FileReferences: {
          Moc: 'model.moc3',
          Textures: ['texture.png'],
        },
      })

      const files = [
        createMockFile('butler.model3.json', modelJson),
        createMockFile('texture.png'),
      ]

      const config = await loader.loadModel(files)

      expect(config.name).toBe('butler')
      expect(config.modelPath).toBe('butler.model3.json')
      expect(config.textures).toContain('texture.png')
      expect(config.id).toBeDefined()
      expect(config.createdAt).toBeDefined()
    })

    it('無効なファイルセットでModelLoadErrorをスローする', async () => {
      const files = [createMockFile('texture.png')]

      await expect(loader.loadModel(files)).rejects.toThrow(ModelLoadError)
    })
  })

  describe('saveModel / listModels', () => {
    it('モデルを保存して一覧を取得できる', async () => {
      const modelConfig = {
        id: 'test-id',
        name: 'Test Model',
        modelPath: 'test.model3.json',
        textures: ['texture.png'],
        motions: {},
        createdAt: Date.now(),
      }

      await loader.saveModel(modelConfig)
      const models = await loader.listModels()

      expect(models).toHaveLength(1)
      expect(models[0].id).toBe('test-id')
    })

    it('同じIDのモデルは更新される', async () => {
      const modelConfig = {
        id: 'test-id',
        name: 'Test Model',
        modelPath: 'test.model3.json',
        textures: ['texture.png'],
        motions: {},
        createdAt: Date.now(),
      }

      await loader.saveModel(modelConfig)

      const updatedConfig = { ...modelConfig, name: 'Updated Model' }
      await loader.saveModel(updatedConfig)

      const models = await loader.listModels()
      expect(models).toHaveLength(1)
      expect(models[0].name).toBe('Updated Model')
    })
  })

  describe('deleteModel', () => {
    it('モデルを削除できる', async () => {
      const modelConfig = {
        id: 'test-id',
        name: 'Test Model',
        modelPath: 'test.model3.json',
        textures: ['texture.png'],
        motions: {},
        createdAt: Date.now(),
      }

      await loader.saveModel(modelConfig)
      await loader.deleteModel('test-id')

      const models = await loader.listModels()
      expect(models).toHaveLength(0)
    })
  })

  describe('getModel', () => {
    it('IDでモデルを取得できる', async () => {
      const modelConfig = {
        id: 'test-id',
        name: 'Test Model',
        modelPath: 'test.model3.json',
        textures: ['texture.png'],
        motions: {},
        createdAt: Date.now(),
      }

      await loader.saveModel(modelConfig)
      const model = await loader.getModel('test-id')

      expect(model).not.toBeNull()
      expect(model!.name).toBe('Test Model')
    })

    it('存在しないIDはnullを返す', async () => {
      const model = await loader.getModel('non-existent')

      expect(model).toBeNull()
    })
  })

  // Property-based tests
  describe('Property Tests', () => {
    // Property 14: モデルファイルの妥当性検証
    it('Feature: butler-assistant-app, Property 14: 有効なファイルセットは検証を通過', () => {
      fc.assert(
        fc.property(
          fc.record({
            modelName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
            textureName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          }),
          ({ modelName, textureName }) => {
            const files = [
              createMockFile(`${modelName}.model3.json`),
              createMockFile(`${textureName}.png`),
            ]
            const result = loader.validateModelFiles(files)

            expect(result.isValid).toBe(true)
          }
        ),
        { numRuns: 100 }
      )
    })

    // Property 16: モデル設定の永続化ラウンドトリップ
    it('Feature: butler-assistant-app, Property 16: 保存→読み込みのラウンドトリップ', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            id: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
            modelPath: fc.string({ minLength: 1 }).map((s) => `${s}.model3.json`),
            textures: fc.array(fc.string().map((s) => `${s}.png`), { minLength: 1, maxLength: 5 }),
            createdAt: fc.integer({ min: 0 }),
          }),
          async (partial) => {
            const config = {
              ...partial,
              motions: {},
            }

            // 保存
            await loader.saveModel(config)

            // 読み込み
            const loaded = await loader.getModel(config.id)

            expect(loaded).not.toBeNull()
            expect(loaded!.id).toBe(config.id)
            expect(loaded!.name).toBe(config.name)

            // クリーンアップ
            await loader.deleteModel(config.id)
          }
        ),
        { numRuns: 50 }
      )
    })
  })
})
