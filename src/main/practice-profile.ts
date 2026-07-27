import { z } from 'zod'
import type { PracticeProfile } from '../shared/types'

const practiceProfileSchema = z.object({
  topic: z.string().trim().min(1).max(80),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']),
  correctionStrength: z.enum(['light', 'normal', 'strict']),
  source: z.enum(['chatgpt-web', 'api-direct']),
  mode: z.enum(['text', 'voice']),
  focus: z.string().trim().max(2_000).optional(),
  prompt: z.string().trim().min(1).max(8_000).optional()
})

const prompts: Record<PracticeProfile['topic'], string> = {
  '日常聊天': 'Have a natural spoken English conversation with me. Ask one question at a time and gently adapt to my level.',
  '旅行英语': 'Role-play as a friendly travel companion. Use practical travel English and ask one question at a time.',
  '面试英语': 'Act as an English interviewer. Ask realistic interview questions, wait for my spoken answer, then continue.',
  '职场会议': 'Role-play a concise workplace meeting in English. Use realistic business situations and turn-taking.',
  '雅思口语': 'Act as an IELTS speaking examiner. Ask one question at a time and keep the session natural.',
  '自由闲聊': 'Start a friendly English free conversation. Keep your turns short enough for speaking practice.',
  '情景角色扮演': 'Offer a practical English role-play scenario and begin the conversation in character.'
}

export function parsePracticeProfile(input: unknown): PracticeProfile {
  return practiceProfileSchema.parse(input)
}

export function buildPracticePrompt(profile: Pick<PracticeProfile, 'topic' | 'level' | 'correctionStrength' | 'focus' | 'prompt'>): string {
  if ('prompt' in profile && profile.prompt) return `${profile.prompt}${profile.focus ? `\n\n本次重点：\n${profile.focus}` : ''}`
  const correction = profile.correctionStrength === 'light'
    ? 'Correct only mistakes that block understanding.'
    : profile.correctionStrength === 'strict'
      ? 'Notice grammar and word-choice mistakes and briefly model a better version.'
      : 'Gently correct important mistakes without interrupting the conversation.'
  const focus = profile.focus ? `\n\nFocus this practice on the learner's previous weak points:\n${profile.focus}` : ''
  return `${prompts[profile.topic]}\n\nMy CEFR level is ${profile.level}. Use vocabulary, grammar, and sentence length appropriate for this level. Speak clearly and use short turns. ${correction}${focus}`
}
