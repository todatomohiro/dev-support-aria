import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import { CameraPreview } from '../CameraPreview'
import type { CameraPreviewHandle } from '../CameraPreview'

// useCamera をモック
const mockStart = vi.fn()
const mockStop = vi.fn()
const mockCaptureFrame = vi.fn()

vi.mock('@/hooks/useCamera', () => ({
  useCamera: () => ({
    videoRef: { current: null },
    status: mockStatus,
    error: mockError,
    captureFrame: mockCaptureFrame,
    start: mockStart,
    stop: mockStop,
  }),
}))

let mockStatus: 'inactive' | 'starting' | 'active' | 'error' = 'inactive'
let mockError: string | null = null

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockStatus = 'inactive'
  mockError = null
})

describe('CameraPreview', () => {
  it('enabled=false の場合 null をレンダリングする', () => {
    const { container } = render(<CameraPreview enabled={false} />)

    expect(container.innerHTML).toBe('')
    expect(screen.queryByTestId('camera-preview')).not.toBeInTheDocument()
  })

  it('enabled=true の場合 video 要素が表示される', () => {
    mockStatus = 'active'
    render(<CameraPreview enabled={true} />)

    expect(screen.getByTestId('camera-preview')).toBeInTheDocument()
    const video = screen.getByTestId('camera-preview').querySelector('video')
    expect(video).toBeInTheDocument()
  })

  it('enabled を true→false に切り替えると stop が呼ばれる', () => {
    mockStatus = 'active'
    const { rerender } = render(<CameraPreview enabled={true} />)

    mockStatus = 'inactive'
    rerender(<CameraPreview enabled={false} />)

    expect(mockStop).toHaveBeenCalled()
  })

  it('ref 経由で captureFrame() が呼べる', () => {
    mockStatus = 'active'
    mockCaptureFrame.mockReturnValue('dGVzdA==')
    const ref = createRef<CameraPreviewHandle>()

    render(<CameraPreview ref={ref} enabled={true} />)

    expect(ref.current).not.toBeNull()
    const frame = ref.current!.captureFrame()
    expect(frame).toBe('dGVzdA==')
    expect(mockCaptureFrame).toHaveBeenCalled()
  })

  it('status=starting 時にスピナーが表示される', () => {
    mockStatus = 'starting'
    render(<CameraPreview enabled={true} />)

    // animate-spin クラスを持つ要素がある
    const spinner = screen.getByTestId('camera-preview').querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('error 時にエラーメッセージが表示される', () => {
    mockStatus = 'error'
    mockError = 'カメラの使用が許可されていません'
    render(<CameraPreview enabled={true} />)

    expect(screen.getByText('カメラの使用が許可されていません')).toBeInTheDocument()
  })
})
