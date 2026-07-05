export type MergeStateAction<State> = Partial<State> | ((state: State) => Partial<State>);

export function mergeStateReducer<State>(state: State, nextState: MergeStateAction<State>) {
  const patch = typeof nextState === "function" ? nextState(state) : nextState;
  return { ...state, ...patch };
}
