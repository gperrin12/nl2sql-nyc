import { TRIVIA_SESSION_LENGTH } from "@/lib/trivia-hiscores";
import {
  buildSessionCategoryPlan,
  categoriesForDeck,
  DEFAULT_TRIVIA_DECK,
  getTriviaCategoryById,
  type TriviaDeck,
  type TriviaSessionConstraints,
} from "@/lib/trivia-categories";

export type TriviaSessionState = {
  deck: TriviaDeck;
  categoryPlan: string[];
  planIndex: number;
  recentQuestions: string[];
  usedFamilies: string[];
};

export function createTriviaSessionState(
  deck: TriviaDeck = DEFAULT_TRIVIA_DECK
): TriviaSessionState {
  return {
    deck,
    categoryPlan: buildSessionCategoryPlan(
      TRIVIA_SESSION_LENGTH,
      categoriesForDeck(deck)
    ),
    planIndex: 0,
    recentQuestions: [],
    usedFamilies: [],
  };
}

export function constraintsFromSession(
  state: TriviaSessionState
): TriviaSessionConstraints {
  const categoryId = state.categoryPlan[state.planIndex];
  return {
    deck: state.deck,
    categoryId,
    excludeQuestions:
      state.recentQuestions.length > 0
        ? [...state.recentQuestions]
        : undefined,
    usedFamilies:
      state.usedFamilies.length > 0 ? [...state.usedFamilies] : undefined,
  };
}

/** Call when a question is shown (before advancing plan index for next fetch). */
export function recordTriviaQuestionShown(
  state: TriviaSessionState,
  question: string,
  categoryId?: string
): TriviaSessionState {
  const def = categoryId ? getTriviaCategoryById(categoryId) : undefined;
  const usedFamilies = def
    ? [...new Set([...state.usedFamilies, def.family])]
    : state.usedFamilies;

  const recentQuestions = [...state.recentQuestions, question.trim()].slice(
    -TRIVIA_SESSION_LENGTH
  );

  return {
    ...state,
    planIndex: Math.min(state.planIndex + 1, state.categoryPlan.length),
    recentQuestions,
    usedFamilies,
  };
}
