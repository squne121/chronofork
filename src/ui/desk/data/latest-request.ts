/** 表示先ごとに1つ。要求を中断せずに採用だけ無効化でき、WorkerのA0キャッシュを捨てない。 */
export function createLatestHistoryRequest() {
  let current: symbol | undefined
  return {
    invalidate() { current = undefined },
    begin() {
      const token = Symbol()
      current = token
      return {
        isCurrent: () => token === current,
        /** await後、表示への反映と同じ同期区間で呼ぶ。年・構成の照合もここで行う。 */
        commit<T>(value: T, matches: (value: T) => boolean, publish: (value: T) => void): boolean {
          if (token !== current || !matches(value) || token !== current) return false
          current = undefined
          publish(value)
          return true
        },
      } as const
    },
  } as const
}
