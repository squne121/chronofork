// 版情報（契約 §7 保存形式の版フィールド）。
export type VersionInfo = Readonly<{
  schemaVersion: number
  scenarioVersion: string
  rulesetVersion: string
  legalSystemVersion: string
  /** RNG 未統合の間は null。他セッションの RNG 実装に依存しない。 */
  rngVersion: string | null
}>
