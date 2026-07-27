// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearningDashboard, SessionArchiveDetail, SessionArchiveSummary, SpeakSubApi, VocabularyItem } from '../shared/types'
import { LearningCenter } from './LearningCenter'

const summary: SessionArchiveSummary = { id: '11111111-1111-4111-8111-111111111111', status: 'completed', startedAt: '2026-07-10T10:00:00.000Z', endedAt: '2026-07-10T10:10:00.000Z', durationSeconds: 600, topic: '旅行英语', level: 'B1', source: 'api-direct', mode: 'text', correctionStrength: 'normal', summary: '表达清楚。', estimatedCefr: 'B1', favoriteWords: ['persistent'], hasReview: true }
const detail: SessionArchiveDetail = { ...summary, transcript: [{ speaker: 'user', text: 'I go yesterday.' }], review: { topic: '旅行英语', summary: '表达清楚。', issues: [{ original: 'I go yesterday', improved: 'I went yesterday', reason: '过去时' }], vocabulary: [], nextPractice: '继续过去时。' } }
const word: VocabularyItem = { id: '22222222-2222-4222-8222-222222222222', normalizedTerm: 'persistent', term: 'persistent', meaning: '坚持的', familiarity: 'unfamiliar', firstSavedAt: '2026-07-10T10:00:00.000Z', lastSavedAt: '2026-07-10T10:00:00.000Z', nextReviewAt: '2026-07-10T10:00:00.000Z', occurrenceCount: 1, sessionIds: [summary.id] }
const dashboard: LearningDashboard = { period: 'week', from: '2026-07-04T00:00:00.000Z', to: '2026-07-10T10:00:00.000Z', sessionCount: 1, totalMinutes: 10, practiceDays: 1, streakDays: 1, newVocabulary: 1, masteredVocabulary: 0, dueVocabulary: 1, averageScores: { accuracy: 72, vocabulary: 68, fluency: 75, interaction: 80 }, cefrTrend: [{ date: '2026-07-10', level: 'B1' }], topErrors: [{ category: 'tense', count: 2 }], activity: [{ date: '2026-07-10', sessions: 1, minutes: 10 }] }

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let updateVocabularyFamiliarity: ReturnType<typeof vi.fn>
let reviewVocabulary: ReturnType<typeof vi.fn>

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  updateVocabularyFamiliarity = vi.fn(async () => ({ ...word, familiarity: 'learning' as const }))
  reviewVocabulary = vi.fn(async () => ({ ...word, familiarity: 'learning' as const }))
  const api = { getLearningDashboard: vi.fn(async () => dashboard), searchSessions: vi.fn(async () => [summary]), listVocabulary: vi.fn(async () => [word]), getSessionDetail: vi.fn(async () => detail), createNextPracticeDraft: vi.fn(), deleteSession: vi.fn(), updateVocabularyFamiliarity, reviewVocabulary, getReviewQueue: vi.fn() } as unknown as SpeakSubApi
  window.speaksub = api
})

afterEach(() => { act(() => root.unmount()); container.remove() })
const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)) }) }

describe('LearningCenter', () => {
  it('loads the dashboard and opens the complete archived review', async () => {
    act(() => root.render(<LearningCenter onUseDraft={() => undefined}/>)); await settle()
    expect(container.textContent).toContain('10分钟')
    const history = [...container.querySelectorAll('button')].find((button) => button.textContent === '历史')!
    act(() => history.click()); await settle()
    act(() => container.querySelector<HTMLButtonElement>('.history-row > button')!.click()); await settle()
    expect(container.textContent).toContain('I went yesterday')
    expect(container.textContent).toContain('完整对话')
  })

  it('shows all saved vocabulary, then reveals the answer only after rating a review card', async () => {
    act(() => root.render(<LearningCenter onUseDraft={() => undefined}/>)); await settle()
    const vocabulary = [...container.querySelectorAll('button')].find((button) => button.textContent === '词汇')!
    act(() => vocabulary.click()); await settle()
    expect(container.textContent).toContain('坚持的')
    const start = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '开始复习')!
    await act(async () => start.click())
    expect(container.textContent).not.toContain('坚持的')
    const good = [...container.querySelectorAll<HTMLButtonElement>('.review-ratings button')].find((button) => button.textContent === '一般')!
    await act(async () => good.click())
    expect(reviewVocabulary).toHaveBeenCalledWith(word.id, 'good')
    expect(container.textContent).toContain('坚持的')
    const next = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '下一个单词')!
    act(() => next.click())
    expect(container.textContent).toContain('本轮复习完成')
  })
})
