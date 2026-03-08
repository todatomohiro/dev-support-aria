import { useMemo } from 'react'

interface Particle {
  id: number
  left: string
  size: string
  duration: string
  delay: string
  opacity: number
}

/**
 * キャラクター背景アニメーション（パーティクル + オーロラ）
 *
 * CSS transform + opacity + filter のみで描画するため GPU 合成レイヤーで処理され、
 * Live2D の PixiJS レンダリングと干渉しない。
 */
export function ParticleBackground({ count = 15 }: { count?: number }) {
  const particles = useMemo<Particle[]>(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      size: `${2 + Math.random() * 4}px`,
      duration: `${10 + Math.random() * 15}s`,
      delay: `${Math.random() * 12}s`,
      opacity: 0.15 + Math.random() * 0.25,
    })), [count])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* オーロラ（ぼかしグラデーション） */}
      <div className="absolute animate-aurora-move" style={{ width: 300, height: 200, top: '10%', left: '-10%', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', filter: 'blur(80px)', opacity: 0.25, animationDuration: '8s' }} />
      <div className="absolute animate-aurora-move" style={{ width: 250, height: 250, top: '30%', right: '-15%', borderRadius: '50%', background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', filter: 'blur(80px)', opacity: 0.25, animationDuration: '10s', animationDelay: '-3s' }} />
      <div className="absolute animate-aurora-move" style={{ width: 350, height: 180, bottom: '10%', left: '20%', borderRadius: '50%', background: 'linear-gradient(135deg, #a78bfa, #ec4899)', filter: 'blur(80px)', opacity: 0.25, animationDuration: '12s', animationDelay: '-6s' }} />
      {/* パーティクル */}
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full animate-particle-drift"
          style={{
            left: p.left,
            bottom: 0,
            width: p.size,
            height: p.size,
            animationDuration: p.duration,
            animationDelay: p.delay,
            backgroundColor: `rgba(129, 140, 248, ${p.opacity})`,
          }}
        />
      ))}
    </div>
  )
}
