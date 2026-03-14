import { useState, useCallback, useEffect, useRef } from 'react'
import { modelService } from '@/services/modelService'
import type { ServerModel } from '@/services/modelService'
import { useAuthStore } from '@/auth/authStore'

/** オンボーディングデータ */
export interface OnboardingData {
  nickname: string
  gender: '' | 'male' | 'female' | 'other' | 'none'
  aiName: string
  tone: 'friendly' | 'polite' | 'casual' | ''
  selectedModelId?: string
  occupation: string
  interests: string[]
  lifestyle?: string
}

interface OnboardingProps {
  /** 完了コールバック */
  onComplete: (data: OnboardingData) => void
  /** 編集モード（メニューから再オープン時） */
  mode?: 'initial' | 'edit'
  /** 編集時の初期値 */
  initialData?: Partial<OnboardingData>
}

/** 職業選択肢 */
const OCCUPATIONS = ['会社員', '学生', 'フリーランス', '主婦・主夫', 'その他']

/** 興味タグ */
const INTEREST_TAGS = ['音楽', '映画・ドラマ', 'ゲーム', '読書', '料理', 'スポーツ', '旅行', 'テクノロジー', 'アート', 'ファッション', 'ペット', 'アニメ']

/** 最大興味タグ数 */
const MAX_INTERESTS = 3

/** ステップナビゲーターのラベル */
const STEP_LABELS = [
  { num: 1, label: 'あなたについて' },
  { num: 2, label: '相棒の設定' },
  { num: 3, label: 'パーソナライズ' },
]

/** PC版サイドパネル（コンポーネント外に定義してフォーカス消失を防止） */
function SidePanel({ step }: { step: number }) {
  return (
    <div className="hidden md:flex flex-col w-[340px] shrink-0 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 rounded-l-3xl p-8 text-white relative overflow-hidden">
      {/* 装飾背景 */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-white/20" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-white/15" />
      </div>

      <div className="relative z-10 flex flex-col h-full">
        {/* ロゴ */}
        <div className="mt-8 text-center">
          <div className="text-4xl font-extrabold tracking-tight">Ai-Ba</div>
          <div className="text-sm font-medium tracking-[4px] mt-1 text-blue-200">AI &nbsp; PARTNER</div>
        </div>

        {/* タグライン */}
        <div className="text-center mt-8 text-sm text-blue-100 leading-relaxed">
          あなただけの相棒を<br />一緒に作りましょう
        </div>

        {/* ステップナビゲーター */}
        <div className="mt-10 space-y-3">
          {STEP_LABELS.map(({ num, label }) => {
            const isActive = step === num
            const isDone = step > num
            return (
              <div
                key={num}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${
                  isActive
                    ? 'bg-white/20 backdrop-blur-sm'
                    : isDone
                      ? 'opacity-80'
                      : 'opacity-40'
                }`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all ${
                  isDone
                    ? 'bg-white text-blue-600'
                    : isActive
                      ? 'bg-white/30 text-white border border-white/50'
                      : 'bg-white/10 text-white/70 border border-white/20'
                }`}>
                  {isDone ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <polyline points="20 6 9 17 4 12" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : num}
                </div>
                <span className={`text-sm font-medium ${isActive ? 'text-white' : 'text-blue-200'}`}>
                  {label}
                </span>
              </div>
            )
          })}
        </div>

        <div className="mt-auto" />
      </div>
    </div>
  )
}

/**
 * オンボーディング画面コンポーネント
 * 初回ログイン時に表示するウィザード形式の初期設定画面
 */
export function Onboarding({ onComplete, mode = 'initial', initialData }: OnboardingProps) {
  const [step, setStep] = useState(mode === 'edit' ? 1 : 0)
  const [prevStep, setPrevStep] = useState(-1)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const sparkleContainerRef = useRef<HTMLDivElement>(null)

  // フォームデータ
  const [nickname, setNickname] = useState(initialData?.nickname ?? '')
  const [gender, setGender] = useState<OnboardingData['gender']>(initialData?.gender ?? '')
  const [aiName, setAiName] = useState(initialData?.aiName ?? 'アイバ')
  const [tone] = useState<OnboardingData['tone']>(initialData?.tone ?? '')
  const [selectedModelId, setSelectedModelId] = useState(initialData?.selectedModelId ?? '')
  const [occupation, setOccupation] = useState(initialData?.occupation ?? '')
  const [interests, setInterests] = useState<string[]>(initialData?.interests ?? [])
  const [lifestyle] = useState(initialData?.lifestyle ?? '')

  // キャラクターモデル一覧
  const [standardModels, setStandardModels] = useState<ServerModel[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const authStatus = useAuthStore((s) => s.status)

  useEffect(() => {
    if (authStatus !== 'authenticated') return
    setIsLoadingModels(true)
    modelService.listModels()
      .then((models) => setStandardModels(models.filter((m) => (m.modelTier ?? 'standard') === 'standard')))
      .catch((err) => console.error('[Onboarding] モデル取得エラー:', err))
      .finally(() => setIsLoadingModels(false))
  }, [authStatus])

  /** ステップ遷移 */
  const goToStep = useCallback((nextStep: number) => {
    if (isAnimating) return
    setIsAnimating(true)
    setPrevStep(step)
    setStep(nextStep)
    setTimeout(() => setIsAnimating(false), 400)
  }, [step, isAnimating])

  /** 戻るボタン */
  const goBack = useCallback(() => {
    if (step > (mode === 'edit' ? 1 : 0)) {
      goToStep(step - 1)
    }
  }, [step, mode, goToStep])

  /** 興味タグのトグル */
  const toggleInterest = useCallback((value: string) => {
    setInterests(prev => {
      if (prev.includes(value)) return prev.filter(v => v !== value)
      if (prev.length >= MAX_INTERESTS) return prev
      return [...prev, value]
    })
  }, [])

  /** 完了時にスパークルエフェクト */
  useEffect(() => {
    if (step !== 4 || !sparkleContainerRef.current) return
    const container = sparkleContainerRef.current
    const colors = ['#3B82F6', '#60A5FA', '#93C5FD', '#2563EB', '#DBEAFE']

    const createSparkle = () => {
      const sparkle = document.createElement('div')
      const size = Math.random() * 8 + 4
      const x = Math.random() * container.offsetWidth
      const y = Math.random() * container.offsetHeight
      const tx = (Math.random() - 0.5) * 120
      const ty = (Math.random() - 0.5) * 120

      sparkle.style.cssText = `
        position: absolute; width: ${size}px; height: ${size}px;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        border-radius: 50%; left: ${x}px; top: ${y}px;
        pointer-events: none; opacity: 1;
        animation: sparkleAnim 1.2s ease-out forwards;
        --tx: ${tx}px; --ty: ${ty}px;
      `
      container.appendChild(sparkle)
      setTimeout(() => sparkle.remove(), 1200)
    }

    // 初回バースト
    for (let i = 0; i < 20; i++) setTimeout(createSparkle, i * 50)
    // 継続
    const interval = setInterval(createSparkle, 200)
    return () => clearInterval(interval)
  }, [step])

  /** 完了処理 */
  const handleComplete = useCallback(async () => {
    setIsSaving(true)
    try {
      await onComplete({
        nickname,
        gender,
        aiName,
        tone,
        selectedModelId: selectedModelId || undefined,
        occupation,
        interests,
        lifestyle,
      })
    } finally {
      setIsSaving(false)
    }
  }, [onComplete, nickname, gender, aiName, tone, selectedModelId, occupation, interests, lifestyle])

  /** プログレスバーの幅（モバイル用） */
  const progressWidth = step === 0 ? 0 : (step / 4) * 100

  /** ステップの CSS クラス */
  const stepClass = (s: number) => {
    if (s === step) return 'onb-step onb-step-active'
    if (s === prevStep) return s < step ? 'onb-step onb-step-exit-left' : 'onb-step onb-step-exit-right'
    if (s < step) return 'onb-step onb-step-exit-left'
    return 'onb-step onb-step-exit-right'
  }

  // Step 1 の次へボタン有効条件
  const step1Valid = nickname.trim().length > 0
  // Step 2 の次へボタン有効条件（AI名があればOK、モデル選択は任意）
  const step2Valid = aiName.trim().length > 0

  /** フォームステップの共通レイアウト（インライン JSX で展開してフォーカス消失を防止） */
  const formLayout = (children: React.ReactNode) => (
    <>
      {/* モバイル: フルスクリーン */}
      <div className="md:hidden flex flex-col h-full">
        {children}
      </div>
      {/* PC: カードレイアウト */}
      <div className="hidden md:flex h-full">
        <SidePanel step={step} />
        <div className="flex-1 flex flex-col min-w-0 rounded-r-3xl bg-white dark:bg-gray-900">
          {children}
        </div>
      </div>
    </>
  )

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900 md:bg-blue-50/60 md:dark:bg-gray-950 flex items-center justify-center" data-testid="onboarding-screen">
      {/* PC: カード型コンテナ / モバイル: フルスクリーン */}
      <div className="w-full h-full md:w-[960px] md:max-w-[95vw] md:h-auto md:max-h-[90vh] md:min-h-[580px] md:rounded-3xl md:shadow-2xl md:overflow-hidden relative">

        {/* モバイル用プログレスバー */}
        {step > 0 && step < 4 && (
          <div className="md:hidden absolute top-0 left-0 right-0 h-1 bg-gray-100 dark:bg-gray-800 z-50">
            <div
              className="h-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-400 ease-out rounded-r-sm"
              style={{ width: `${progressWidth}%` }}
              data-testid="progress-bar"
            />
          </div>
        )}

        {/* 戻るボタン */}
        {step > (mode === 'edit' ? 1 : 0) && step < 4 && (
          <button
            onClick={goBack}
            className="absolute top-4 left-4 md:left-[356px] z-50 w-10 h-10 rounded-full bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm shadow-sm flex items-center justify-center hover:scale-105 transition-transform"
            data-testid="back-button"
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <polyline points="15 18 9 12 15 6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {/* ステップコンテナ */}
        <div className="relative w-full h-full md:h-[580px]">

          {/* Step 0: ウェルカム */}
          <div className={stepClass(0)} data-testid="step-0">
            <div className="flex flex-col items-center justify-center h-full text-center px-7 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200 dark:from-gray-900 dark:via-blue-950 dark:to-gray-900 md:rounded-3xl"
                 style={{ backgroundSize: '200% 200%', animation: 'gradientShift 8s ease infinite' }}>
              <div className="animate-[logoReveal_800ms_cubic-bezier(0.34,1.56,0.64,1)_300ms_both]">
                <div className="text-5xl sm:text-6xl font-extrabold bg-gradient-to-br from-blue-500 to-blue-700 bg-clip-text text-transparent tracking-tight">
                  Ai-Ba
                </div>
                <div className="text-sm text-blue-500 font-medium tracking-[4px] mt-0.5">
                  AI &nbsp; PARTNER
                </div>
              </div>
              <div className="text-xl font-semibold text-gray-700 dark:text-gray-200 mt-6 leading-relaxed animate-[fadeUp_600ms_ease_700ms_both]">
                あなただけの<br />AI相棒を作ろう
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-3 leading-relaxed animate-[fadeUp_600ms_ease_900ms_both]">
                会話を通じて成長する、<br />世界でひとりだけのAIパートナー
              </div>
              <div className="mt-12 animate-[fadeUp_600ms_ease_1100ms_both]">
                <button
                  onClick={() => goToStep(1)}
                  className="px-14 py-4 text-lg font-bold text-white bg-gradient-to-br from-blue-500 to-blue-600 rounded-full shadow-[0_4px_16px_rgba(59,130,246,0.35)] hover:shadow-[0_6px_20px_rgba(59,130,246,0.45)] active:scale-95 transition-all"
                  data-testid="start-button"
                >
                  はじめる
                </button>
              </div>
            </div>
          </div>

          {/* Step 1: ニックネーム・性別 */}
          <div className={stepClass(1)} data-testid="step-1">
            {formLayout(
              <div className="flex flex-col h-full pt-16 px-7 md:px-10 pb-8">
                <div>
                  <h2 className="text-[22px] font-bold text-gray-800 dark:text-gray-100 leading-snug">
                    まず、あなたのことを<br className="md:hidden" />教えてください
                  </h2>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-1.5 leading-relaxed">
                    相棒があなたを呼ぶ名前です
                  </p>
                </div>

                {/* ニックネーム */}
                <div className="relative mt-7">
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value.slice(0, 20))}
                    maxLength={20}
                    placeholder=" "
                    autoComplete="off"
                    className="peer w-full md:max-w-sm pt-5 pb-2 px-4 text-[17px] font-medium border-2 border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-blue-400 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] focus:bg-white dark:focus:bg-gray-700 transition-all placeholder:text-transparent"
                    data-testid="nickname-input"
                  />
                  <label className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-gray-400 pointer-events-none transition-all duration-200 peer-focus:top-2.5 peer-focus:translate-y-0 peer-focus:text-[11px] peer-focus:text-blue-500 peer-focus:font-semibold peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:text-blue-500 peer-[:not(:placeholder-shown)]:font-semibold">
                    ニックネーム
                  </label>
                </div>

                {/* 性別 */}
                <div className="mt-7">
                  <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 block mb-2.5">性別</span>
                  <div className="flex flex-wrap gap-2.5">
                    {([['male', '男性'], ['female', '女性'], ['other', 'その他'], ['none', '答えない']] as const).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setGender(value)}
                        className={`px-5 py-2.5 text-sm font-medium rounded-full border-2 transition-all duration-200 ${
                          gender === value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 shadow-[0_0_0_4px_rgba(59,130,246,0.1)]'
                            : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500'
                        }`}
                        data-testid={`gender-${value}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-auto pt-8 md:max-w-xs">
                  <button
                    onClick={() => goToStep(2)}
                    disabled={!step1Valid}
                    className="w-full py-4 text-base font-bold text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl shadow-md disabled:from-gray-300 disabled:to-gray-300 disabled:shadow-none dark:disabled:from-gray-700 dark:disabled:to-gray-700 active:scale-[0.98] transition-all"
                    data-testid="step1-next"
                  >
                    次へ
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: AI名前・トーン */}
          <div className={stepClass(2)} data-testid="step-2">
            {formLayout(
              <div className="flex flex-col h-full pt-14 px-7 md:px-10 pb-6">
                <div>
                  <h2 className="text-[22px] font-bold text-gray-800 dark:text-gray-100 leading-snug">
                    相棒の名前を決めましょう
                  </h2>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 leading-relaxed">
                    いつでも変更できます
                  </p>
                </div>

                {/* AI名前 */}
                <div className="relative mt-5">
                  <input
                    type="text"
                    value={aiName}
                    onChange={(e) => setAiName(e.target.value.slice(0, 20))}
                    maxLength={20}
                    placeholder=" "
                    autoComplete="off"
                    className="peer w-full md:max-w-sm pt-5 pb-2 px-4 text-[17px] font-medium border-2 border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-blue-400 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] focus:bg-white dark:focus:bg-gray-700 transition-all placeholder:text-transparent"
                    data-testid="ainame-input"
                  />
                  <label className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-gray-400 pointer-events-none transition-all duration-200 peer-focus:top-2.5 peer-focus:translate-y-0 peer-focus:text-[11px] peer-focus:text-blue-500 peer-focus:font-semibold peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:text-blue-500 peer-[:not(:placeholder-shown)]:font-semibold">
                    AI の名前
                  </label>
                </div>

                {/* キャラクター選択 */}
                <div className="mt-5">
                  <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 block mb-2">キャラクターを選ぶ</span>
                  {isLoadingModels ? (
                    <p className="text-sm text-gray-400 dark:text-gray-500">読み込み中...</p>
                  ) : standardModels.length === 0 ? (
                    <p className="text-sm text-gray-400 dark:text-gray-500">利用可能なキャラクターがありません</p>
                  ) : (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                      {standardModels.map((model) => {
                        const isSelected = selectedModelId === model.modelId
                        return (
                          <button
                            key={model.modelId}
                            onClick={() => setSelectedModelId(model.modelId)}
                            className={`flex flex-col items-center p-2.5 rounded-2xl border-2 transition-all duration-200 ${
                              isSelected
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 shadow-[0_0_0_4px_rgba(59,130,246,0.1)]'
                                : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500'
                            }`}
                            data-testid={`model-${model.modelId}`}
                          >
                            <div className="w-12 h-[60px] md:w-14 md:h-[70px] rounded-[24px_24px_12px_12px] overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-1.5">
                              {model.avatarUrl ? (
                                <img src={model.avatarUrl} alt={model.name} className="w-full h-full object-cover" />
                              ) : (
                                <svg className="w-6 h-6 text-gray-300 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                              )}
                            </div>
                            <span className={`text-[11px] font-semibold text-center line-clamp-1 ${
                              isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
                            }`}>
                              {model.name}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* 選択中キャラクターの詳細 */}
                  {(() => {
                    const selected = standardModels.find((m) => m.modelId === selectedModelId)
                    const cc = selected?.characterConfig
                    if (!selected || !cc) return null
                    const genderLabel = cc.characterGender === 'female' ? '女性' : cc.characterGender === 'male' ? '男性' : cc.characterGender === 'other' ? 'その他' : ''
                    return (
                      <div className="mt-3 p-3 rounded-xl bg-blue-50/60 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-800/30">
                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
                          {cc.characterName || selected.name}
                          <span className="text-[10px] font-medium text-blue-500 dark:text-blue-400 ml-1.5 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 rounded">モデル</span>
                          {(cc.characterAge || genderLabel) && (
                            <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">
                              ({[cc.characterAge, genderLabel].filter(Boolean).join(' / ')})
                            </span>
                          )}
                        </div>
                        {cc.characterPersonality && (
                          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-2">
                            {cc.characterPersonality}
                          </p>
                        )}
                      </div>
                    )
                  })()}
                </div>

                <div className="mt-auto pt-5 md:max-w-xs">
                  <button
                    onClick={() => goToStep(3)}
                    disabled={!step2Valid}
                    className="w-full py-3.5 text-base font-bold text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl shadow-md disabled:from-gray-300 disabled:to-gray-300 disabled:shadow-none dark:disabled:from-gray-700 dark:disabled:to-gray-700 active:scale-[0.98] transition-all"
                    data-testid="step2-next"
                  >
                    次へ
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 3: 任意情報 */}
          <div className={stepClass(3)} data-testid="step-3">
            {formLayout(
              <div className="flex flex-col h-full pt-16 px-7 md:px-10 pb-8 overflow-y-auto">
                <div>
                  <h2 className="text-[22px] font-bold text-gray-800 dark:text-gray-100 leading-snug">
                    もう少し教えてください
                  </h2>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-1.5 leading-relaxed">
                    スキップもできます。後から変更可能です
                  </p>
                </div>

                {/* 職業 */}
                <div className="mt-6">
                  <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 block mb-2.5">お仕事・立場</span>
                  <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
                    {OCCUPATIONS.map(occ => (
                      <button
                        key={occ}
                        onClick={() => setOccupation(prev => prev === occ ? '' : occ)}
                        className={`px-4 py-2 text-sm font-medium rounded-full border transition-all whitespace-nowrap ${
                          occupation === occ
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                            : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                        }`}
                        data-testid={`occupation-${occ}`}
                      >
                        {occ}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 興味 */}
                <div className="mt-6">
                  <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 block mb-2.5">
                    興味・関心<span className="text-xs text-gray-400 dark:text-gray-500 ml-1">（最大3つ）</span>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {INTEREST_TAGS.map(tag => {
                      const selected = interests.includes(tag)
                      const disabled = !selected && interests.length >= MAX_INTERESTS
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleInterest(tag)}
                          disabled={disabled}
                          className={`px-3.5 py-2 text-sm font-medium rounded-xl border transition-all ${
                            selected
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                              : disabled
                                ? 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                          }`}
                          data-testid={`interest-${tag}`}
                        >
                          {tag}
                        </button>
                      )
                    })}
                  </div>
                </div>


                <div className="mt-auto pt-8 flex flex-col gap-3 md:max-w-xs">
                  <button
                    onClick={() => goToStep(4)}
                    className="w-full py-4 text-base font-bold text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl shadow-md active:scale-[0.98] transition-all"
                    data-testid="step3-next"
                  >
                    次へ
                  </button>
                  <button
                    onClick={() => {
                      setOccupation('')
                      setInterests([])
                      goToStep(4)
                    }}
                    className="w-full py-3 text-sm font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    data-testid="step3-skip"
                  >
                    スキップ
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 4: 完了 */}
          <div className={stepClass(4)} data-testid="step-4">
            <div className="flex flex-col items-center justify-center h-full text-center px-7 bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 md:rounded-3xl relative">
              {/* スパークルエフェクト */}
              <div ref={sparkleContainerRef} className="absolute inset-0 pointer-events-none overflow-hidden" />

              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg animate-[scaleIn_500ms_cubic-bezier(0.34,1.56,0.64,1)_both]">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-6 animate-[fadeUp_600ms_ease_300ms_both]">
                準備完了！
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 animate-[fadeUp_600ms_ease_500ms_both]">
                {aiName || 'あなたの相棒'}が待っています
              </p>

              {/* サマリー */}
              <div className="mt-8 w-full max-w-xs text-left bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl p-5 shadow-sm animate-[fadeUp_600ms_ease_700ms_both]">
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400 dark:text-gray-500">ニックネーム</span>
                    <span className="font-medium text-gray-800 dark:text-gray-100">{nickname}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400 dark:text-gray-500">AI の名前</span>
                    <span className="font-medium text-gray-800 dark:text-gray-100">{aiName || 'アイバ'}</span>
                  </div>
                  {occupation && (
                    <div className="flex justify-between">
                      <span className="text-gray-400 dark:text-gray-500">お仕事</span>
                      <span className="font-medium text-gray-800 dark:text-gray-100">{occupation}</span>
                    </div>
                  )}
                  {interests.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400 dark:text-gray-500 shrink-0">興味</span>
                      <span className="font-medium text-gray-800 dark:text-gray-100 text-right">{interests.join('、')}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-10 w-full max-w-xs animate-[fadeUp_600ms_ease_900ms_both]">
                <button
                  onClick={handleComplete}
                  disabled={isSaving}
                  className="w-full py-4 text-base font-bold text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl shadow-md active:scale-[0.98] transition-all disabled:opacity-60"
                  data-testid="complete-button"
                >
                  {isSaving ? '設定中...' : mode === 'edit' ? '更新する' : '相棒と話してみよう'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* アニメーション用 CSS */}
      <style>{`
        @keyframes gradientShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes logoReveal {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.5); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes sparkleAnim {
          0% { opacity: 1; transform: translate(0, 0) scale(1); }
          100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0); }
        }
        .onb-step {
          position: absolute; inset: 0;
          opacity: 0; pointer-events: none;
          transition: opacity 350ms ease, transform 350ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        .onb-step-active {
          opacity: 1; transform: translateX(0);
          pointer-events: auto;
        }
        .onb-step-exit-left {
          opacity: 0; transform: translateX(-80px);
        }
        .onb-step-exit-right {
          opacity: 0; transform: translateX(80px);
        }
      `}</style>
    </div>
  )
}
