import type { NextPracticeDraft, PracticeLifecycle, PromptTemplates } from '../shared/types'

export function isPracticeTransitionBusy(lifecycle: PracticeLifecycle): boolean {
  return lifecycle === 'starting' || lifecycle === 'ending'
}

export function templateSelectionForDraft(
  draft: NextPracticeDraft,
  templates: PromptTemplates
): Partial<Record<keyof PromptTemplates, string>> {
  return {
    scenario: templates.scenario.find((item) => item.name === draft.topic || item.id === draft.topic)?.id,
    difficulty: templates.difficulty.find((item) => item.name.toUpperCase() === draft.level || item.id === draft.level.toLowerCase())?.id,
    correction: templates.correction.find((item) => item.id === draft.correctionStrength)?.id
  }
}
