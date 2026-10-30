# MVP実装契約

- **状態:** 技術契約（実装準備用）。ゲーム規則は `docs/spec/mvp-spec.md` が正本で、本書は規則を追加・変更しない。技術判断は Claude Code に委任済み（DEC-038）のため、DTO 名・内部構造は改善してよい。ただし**意味と書込責任は変えない**。
- 移行元: 統合提案「MVP 統合実装契約」、共通契約 v0.3、横断レビュー v0.2。これらのうち未承認のゲーム規則に当たるものは含めず `docs/spec/pending-approvals.md` へ分離した。
- ディレクトリ: 本リポジトリの責務分割に従う（`src/simulation/`＝純粋なシミュレーション、`src/scenario/`＝シナリオデータ、`src/ui/`＝React）。移行元資料の `src/sim/` は `src/simulation/` に読み替える。

## 1. 実装方針

- 通常の型付き TypeScript 関数で **評価 → 検証 → 単一 reducer による適用**。独自 DSL・イベントバス・全人口エージェントは作らない（DEC-036）。
- `WorldState` は年初状態。領域ごとの書込所有権を `Command` のタグと owner で検証する。派生値を二重保持しない。
- 37 RuleID を固定 Registry に登録し、各ルールに `implementationStatus: IMPLEMENTED | TODO` を持たせる。`TODO` のルールは**新しい物語イベントを発生させず**、ログ/検証画面に未実装を明示する。
- 係数は `TuningConfig`（`CALIBRATION_ONLY`、`rulesetVersion` 付き）に集約。仮値を法則としてハードコードしない。
- 参照不整合・排他権限衝突・台帳衝突は診断付き拒否または `PENDING`。利益・税収・領主権を勝手に配賦して成功扱いしない。不変条件違反（負残高、二重死亡、親子循環、税権重複、二重 Title）は fail-fast＋原因コード。UI は検証失敗を「ゲーム内の敗北」と表示しない。

## 2. 最小型（インターフェース境界）

完全な定義ではない。名前は改善してよい。

```ts
type Id = string;
type Year = number;                      // 年初 1250..1350
type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7;  // 7 は確定検証のみ
type Domain = "A" | "B" | "C" | "D";     // A=法制 B=人物 C=民生 D=軍事外交
type DecisionStatus = "ACCEPT" | "REJECT" | "DEFER";
type ControllerRef = { kind: "PERSON" | "HOUSE" | "COUNTRY"; id: Id };
type TargetRef =
  | { kind: "PERSON" | "HOUSE" | "GROUP" | "COUNTRY" | "REGION"; id: Id }
  | { kind: "PERSON_PAIR"; ids: readonly [Id, Id] };   // ID 昇順に正規化

type Source = Readonly<{
  requestId: Id; year: Year; phase: Phase;
  sourceRuleId: string; sourceTraceId: Id; sourceIntentId?: Id;
}>;

type RuleOutcome = Readonly<{
  ruleId: string; phase: Phase;
  commands: readonly DomainCommand[];     // 判別可能 union。任意 fieldPath 書込は禁止
  requests: readonly CrossDomainRequest[];
  deferred: readonly DeferredEffect[];    // 翌年施行 (effectiveFromYear = t+1)
  traceDrafts: readonly DecisionTraceDraft[];
}>;
```

`WorldState` は countries / regions / groups / houses / persons / titles / legal / resources(台帳) / demographics / deferred を持つ。`CrossDomainRequest` は `{source, targetDomain, kind, payload, requiredResponseYear}`、応答は `{requestId, status, reasonCodes, payload?}`。循環参照は「照会 → 応答 → 適用」で解決し、同年の上流フェーズを再実行しない。

### 2.1 書込 owner（競合時は reducer が拒否）

| 状態 | 評価/提案 | **唯一の確定者** |
|---|---|---|
| 婚姻契約、法的配偶者、legalDynastyId、Claim、Title、承認、ControlMandate | B/D が意図・証拠、A が適法性 | A の検証済み command を共通 reducer が適用 |
| Person ID・出自・出生年・親子、関係基礎値、婚姻/政治 Intent | B | B の検証済み command |
| Person.alive/deathYear（自然死・戦死） | B 自然死、D 戦死 | **共通死亡 reducer のみ** |
| PopulationGroup.population、出生死亡コホート、繁栄、不満、支持 bps | C 会計、B が枠請求、D が損耗通知 | **共通人口 reducer のみ** |
| 現金残高・兵員残余・排他的予約・戦費 | C 歳入/義務費、D 動員/戦費 | **ResourceLedger reducer のみ** |
| 徴税先、年税・給付/義務費 | A 権原、D 支配事実、C 計算 | TaxCollectionMandate → ResourceLedger reducer |
| Region.sovereignCountryId / deFactoControllerRef、Conflict、外交・軍事事実 | D（条約時は A に適法性照会） | D の検証済み command |
| modifier、歴史分岐、乱数値、EventLog、DecisionTrace、保存版 | 共通 | 共通エンジン |

`Country.treasury` / `militaryStrength`、`House.mobilizationPower`、`Region.population`、`hasTerritorialControl` は**派生値**。家門の支持者推計を `PopulationGroup.population` に加算しない。`Office`（非世襲の行政職）と `Title` は別型。B が法的配偶者を登録する、D が戦死者の人口を直接減らす、は禁止。

## 3. 適用と取引の原子性

- `evaluateRule(readonlyWorld, context): RuleOutcome` / `applyOutcome(world, outcome): ApplyResult`。`DomainCommand` は `MARRIAGE_REGISTER / LEGAL_TITLE_TRANSFER / LEGAL_CASE_SET / PERSON_BIRTH / PERSON_DEATH / POPULATION_COHORT / POPULATION_CASUALTY / SUPPORT_SET / TAX_MANDATE_SET / RESOURCE_TRANSACTION / REGION_CONTROL_SET / TREATY_COMMIT` 等の判別可能 union。権限チェックは省略不可。
- `sourceRuleId` は既存 37 件から選ぶ。engine 初期化/整合性処理で新たなゲーム RuleID を発行しない。`traceId` は評価時に決定的に作り、各 request と成功 Event にリンクする。
- `requestId` は年・フェーズ・RuleID・対象・意味的原因から**決定的かつ一意**。`branchId` を乱数キー/人物 ID に使わない。冪等性は実行中の枝/年次トランザクション内で判定（別枝では独立）。同 ID・同内容の再送は `DUPLICATE`、同 ID・異内容は `CONFLICT`。
- 一つの意味的操作の複数 command/ResourceTransaction は同一 `batchId` で**全件事前検証 → 全件コミット**（部分適用禁止）。検証不成立は DecisionTrace のみで、状態を偽装する EventLog を作らない。合法性未確定は `DEFER` と PENDING ケース。
- ⑤で確定した軍事占領は、⑥の条約審査が失敗しても巻き戻さない。原子性の対象は、その条約が追加する A/D の法的・主権 Delta。

### 3.1 ResourceLedger（構造のみ。係数は暫定）

```ts
type ResourceKind = "CASH_MILLI_BU" | "FORCE_HEADCOUNT";
type ResourceAccount = Readonly<{
  accountId: Id; kind: ResourceKind;
  ownerRef: ControllerRef | { kind: "GROUP"; id: Id };
  quantity: number; committed: number;       // 非負整数、0 <= committed <= quantity
  sourceGroupId?: Id; sourceRegionId?: Id;
}>;
type ResourceOperation = "CREDIT" | "DEBIT" | "COMMIT" | "RELEASE" | "CASUALTY";
```

- 現金と兵員は共通台帳が唯一の保存先。C は税収・義務費、D は戦費・徴兵・損耗を `ResourceTransaction` で要求する。C が兵数、D が国庫を別にコピー加算しない。現金実残高 = `opening + 実入金 − 実出金`。
- 兵源は年度の集団ごとに人口由来の**単一の物理 ForcePool**。国軍・家門軍・反乱軍は同じ Pool の排他的 `COMMIT` を要求し、⑤と⑥で再生成しない。損耗は予約兵から一度だけ確定し、同一 `casualtyId` で人口 reducer へ通知。翌年の Pool は最新人口から導出し直す。
- **単位:** `1BU = 1000 整数内部単位` は技術換算の提案。「国庫 45/100」は表示上の初期傾向で、45BU の承認ではない。初期残高・税率・換算・戦費は `CALIBRATION_ONLY`。国庫に 100 の上限を設けない。

## 4. 人口・人物・死亡

- 人口集団の人数 `PopulationGroup.population` が唯一の一次値。重要人物はその内訳（代表）であり、生成/昇格で人口を加算しない。1250 年の詳細 8 人と Roster 候補は人口に既に含まれる。
- C① が各集団の粗出生枠 B・自然死枠 N と人口増減を一度だけ確定。B③ が枠の一部を個別人物に割当てる。未請求枠は匿名の人口変化で、個別 Person の生成/死亡で人口を再増減させない。枠不足は `NO_COHORT_SLOT`、記名者数が人口を超える場合は `COHORT_CAPACITY_CONFLICT` で停止。
- 暫定分解式（**採用済みゲーム法則ではない**・係数は試験値）: `delta = round(P*(1+g)) − P; B = max(0, round(P*b), delta); N = B − delta`。
- 後年に匿名人物を昇格させるには、予登録 Anchor/出自（生存の裏付け）が必要。新 Person ID は親・出生年・候補 slot・版から決定的に付与し、名前・枝番号・表示順に依存させない。
- 出生者の `legalDynastyId` は **A のみ**が決定。父母・有効婚姻・適法な母系条項の証拠がなければ `UNDETERMINED`/PENDING（自動でナルヴェン所属にしない。GAME-01）。
- D の戦闘死者 3 人（うち固有人物 1 人）なら人口は 3 人減。自然死済み人物への戦死要求は `ALREADY_DEAD` で拒否。名前付き戦死者数 <= 集団戦死数。
- 毎年⑦で検証: `group.population >= 生存記名人物数`、出自 Group 一意、親子循環なし、親の birthYear < 子の birthYear、法的配偶者の相互整合。

## 5. 法制・地域支配・税権

- `Title { titleId, kind: TERRITORIAL|CROWN, regionId, holderPersonId, hereditary, valid, grantBasisId, recognition{status ACTIVE|PENDING|REVOKED, authorityId, sovereignCountryId, sourceDecisionId} }`。`ControlMandate { mandateId, regionId, controllerRef, beneficiaryPersonId, authorizingTitleId, sourceEventId, effectiveFromYear, endExclusiveYear }`。`TaxCollectionMandate { regionId, collectorCountryId, effectiveFromYear, endExclusiveYear, sourceTreatyOrLawId }`。`LegalCase { caseId, titleId, kind SUCCESSION|RECOGNITION|REVOCATION, status PENDING|APPROVED|REJECTED, candidatePersonIds, reasonCodes }`。
- D は実効支配事実と上位主権、A は承認済み Title と委任の法的証拠を保持する。
- **`evaluateGoal`（1350 年の純粋関数）:** 存命のナルヴェン Person → 有効・承認済み・世襲の `TERRITORIAL` Title → 対象 Region → 本人の直接支配、または受益者が一致する有効な ControlMandate、をすべて照合して初めて true。House/Country の一致、税収、称号のみ、`suzerainCountryId`/`sovereignCountryId` のみでは成功/失敗を短絡しない。`CROWN` のみは勝利にならない。
- ControlMandate は region + controller + beneficiary + title + 有効境界を照合。受益者死亡・Title 失効後に別人へ自動引継ぎしない。新継承者への委任継続は承認可能な既存証拠がなければ PENDING（GAME-03）。
- 徴税先は**地域×年度で高々 1 件**。C① は当年の有効 TaxCollectionMandate を参照し、合法な collector へ一度だけ入金。宗主・占領者・Title 保持者へ暗黙にコピーしない。⑤⑥の当年変更は①へ遡及しない。翌年の根拠不明は `UNRESOLVED_TAX_AUTHORITY`（診断のみ。GAME-04）。
- ⑥条約: D の合意 → A の純粋な適法性審査 → 承認意思・権限が当年完備なら A/D の条約 Delta を一括確定。追加の裁量審査が必要なら PENDING。**1349 年の PENDING は 1350 年に解消しない**（1350 年は評価のみ）。
- ④後（⑤⑥）の戦死: 共通 reducer で 1 回だけ死亡を確定。既存法のみで唯一かつ追加承認不要な相続に限り限定即時移転、それ以外は PENDING。死者が保持する Title・未承認 Title は勝利にしない。

## 6. 支持・年次境界

- C② の支持更新入力は、C① の生活/給付と**前年以前**の B③・D⑤⑥の原因 ID 付き `SupportSignal`。同年 B③ の政策は `DeferredEffect(effectiveFromYear = t+1)`。`sourceEventId` の無い自然均等化は禁止。
- 信号無し・資格変化なしなら家門支持 bps 配列をビット単位で維持。信号ありなら `max(0, prevBps + scale*signal…)` → 最大剰余法で無党派込み 10000bps に正規化（`scale` は仮係数）。`group.unrest` 介入単独で他集団の給付を移動させない。

| 時点 | 処理 / 書込境界 |
|---|---|
| 年初 | 年初 WorldState、t 年 modifier の有効値、前年繰越の確認 |
| ① C | 天候・生産 → 税・生活 → 粗出生/自然死枠と人口・財政の実取引。t 年の徴税先を固定 |
| ② C | 不満 → 原因付き家門支持 → 派生集計（③B の当年結果は読まない） |
| ③ B+A照会 | ③a 自然死 → ③b 出生 → ③c 候補昇格 → ③d〜f 縁談・政策 Intent。出生後に A が法的所属、婚姻成立は A のみ登録 |
| ④ A | 繰越 PENDING、剥奪、継承候補、Title 承認。死亡済み人物は後続判断しない |
| ⑤ D | 反乱 → 動員/戦費 → 衝突/戦死 → 実効統治変更 |
| ⑥ D+A | 対外軍事・戦死確定 → 限定即時相続 → 条約の A 法照会 → 合法な条約 Delta の一体適用、未承認は PENDING |
| ⑦ Core | 台帳/親子/法/支持/ログの照合、t+1 年初 WorldState へ。**1350 年の新年度計算は実行しない** |

③a〜f は③内の技術的順序であり、①〜⑦の大枠は変えない。

## 7. 乱数・介入・履歴・保存

- `drawRandom(seed, {stream: EXOGENOUS|ENDOGENOUS, year, phase, ruleId, actorId, targetId, eventKey})` は同期・決定的。`branchId`・配列走査順・状態スコアをキーに混ぜない。外生乱数（同年同地域の天候等）は枝が違っても同値。内生乱数は抽選値が同じでも状態由来の閾値で結果が変わり得る。`rngVersion` を固定し既知ベクトルで検証。
- `StatDefinition { statKey, targetKind, ownerDomain, unit, min, max, valueKind BASE|DERIVED, playerEditable, editPolicy BOUNDED_MODIFIER|DOMAIN_VALIDATED|NONE, defaultEffect?, referencingRuleIds }`。結果/法的状態は `playerEditable=true` にしない。人口・支持・兵力・現金は、安全な専用処理が無い間は表示のみで直接編集不可。実装済みルールが**実際に参照する**数値のみ順次登録する。
- 介入は基礎値でなく `StatModifier { modifierId, interventionId, targetRef, statKey, signedDelta, startYear, endExclusiveYear, decayPolicy NONE|LINEAR, ruleVersion }` として保持。期間は `[startYear, endExclusiveYear)`。同項目・異年は重ね掛け可（合計後に一度 clamp/round）。線形減衰・丸めは試験用の技術選択。同年・同対象・同 statKey の二重命令は拒否。`commandId` の冪等性も保証。
- `forkHistory` は現行枝の `snapshots[t]`（年初）と保持すべき介入から新枝を生成し t〜1349 を再計算。旧枝は書き換えない。A0 の保存再現も同じ処理。
- 保存: `{schemaVersion, scenarioVersion, rulesetVersion, legalSystemVersion, rngVersion, seed, activeBranchId, branches:[{parent, forkYear, interventions}], checksum}` を localStorage へ。算出済み WorldState を長期正本にせず、ロード時に版確認して再計算。未知版/破損は安全に拒否し、旧セーブを暗黙に新規則へ当てない。
- `DecisionTrace { traceId, year, phase, ruleId, actorRef, candidates[{candidateId, eligible, inputs, score?, threshold?, reasonCodes}], selectedCandidateId, status, reasonCodes, modifierIds, random?{stream,key,value}, eventIds, ruleVersion }`、`EventLog { eventId, semanticEventKey, year, phase, eventType, involvedRefs, stateChanges[{path, before, after}], sourceTraceIds }`。`stateChanges` はログ用の値で、実行命令として解釈しない。**未変更の候補判断も Trace に残し、EventLog は確定した状態差分のみ。** 表示上は証明された経路だけ断定し、共変化は「関連する条件」と表す。

## 8. RuleID Registry（改名禁止・37 件）

```text
A-LEG-01  A-DYN-02  A-CLA-03  A-SUC-04  A-SUC-05
A-TIT-06  A-TIT-07  A-TIT-08  A-TIT-09  A-CLA-10
B-001  B-002  B-003  B-004  B-005  B-006  B-007  B-008  B-009
RULE-C-001  RULE-C-002  RULE-C-003  RULE-C-004  RULE-C-005
RULE-C-006  RULE-C-007  RULE-C-008  RULE-C-009
D-REB-001  D-REB-002  D-REB-003  D-MIL-001  D-VAS-002
D-DIP-001  D-MIL-002  D-DIP-002  D-VAS-001
```

A=10 / B=9 / C=9 / D=9。ID は不透明な文字列として扱い、書式の違いを改名の理由にしない（別名が必要なら旧→新の別名表）。

| ID | 内容 | ID | 内容 |
|---|---|---|---|
| A-LEG-01 | 婚姻の法的資格・契約登録 | RULE-C-001 | 地域生産介入 modifier の適用 |
| A-DYN-02 | 法的王朝所属と母系契約 | RULE-C-002 | 局所天候の抽選と年間生産 |
| A-CLA-03 | 血統証拠・傍系請求権の候補化 | RULE-C-003 | 課税量・徴収効率・税収帰属 |
| A-SUC-04 | 土地領主権の相続順位・複数娘 | RULE-C-004 | 生活充足・繁栄・人口の年次変化 |
| A-SUC-05 | 王位継承と土地領主権の非連動 | RULE-C-005 | 国庫収支・義務費・給付予算 |
| A-TIT-06 | 世襲称号の授与・承認 | RULE-C-006 | 集団利益調整 modifier と外部性 |
| A-TIT-07 | 称号相続の法的移転と実効支配照合 | RULE-C-007 | 生活負担と集団不満の更新 |
| A-TIT-08 | 剥奪・赦免・復権と領土返還の非自動性 | RULE-C-008 | 家門別支持割合の更新 |
| A-TIT-09 | 主権変更・臣従における世襲領主権の存続 | RULE-C-009 | 集計と B/D 向け判断資料の公開 |
| A-CLA-10 | 競合請求・争訟・承認却下の裁定 | D-REB-001 | 反乱/動員力と軍事資源の排他的割当 |
| B-001 | 初期 8 人以外の人物候補の生成・昇格 | D-REB-002 | 家門ごとの反乱準備更新 |
| B-002 | 出生・親子の整合的更新 | D-REB-003 | 蜂起/クーデターの成立判定 |
| B-003 | 自然死亡・人物行動停止 | D-MIL-001 | 国内戦闘・鎮圧と実効支配移行 |
| B-004 | 縁談候補探索・自律提案 | D-VAS-002 | 既存封臣の独立要求・離反 |
| B-005 | 縁談の交渉・拒否・法照会と婚姻成立 | D-DIP-001 | 対外圧力・同盟・開戦/不戦の選択 |
| B-006 | 家門別利害・同盟・不一致の判断 | D-MIL-002 | 対外戦闘・疲弊・地域占領 |
| B-007 | 統治者の融和/強硬選好と制度的抵抗 | D-DIP-002 | 講和条件の比較と受諾可否 |
| B-008 | 役職任命・譲歩交渉 | D-VAS-001 | 属国・外国封臣化の実行と法的照会 |
| B-009 | 信頼・野心・人物間関係の累積と介入の参照 | | |

## 9. 横断テスト契約（実装・実行は未着手）

主要な受入観点（詳細な ID・フィクスチャは実装時に `tests/` で定義する）:

1. 同一 1250 年初期値・シード・modifier 台帳・版で、101 スナップショット/EventLog/DecisionTrace が完全一致。
2. 1250→1350 は 100 遷移・101 スナップショット。1350 年に①〜⑦を実行しない。
3. 同年の人物信頼 +20 と地域生産 +10 は両方残り、より後の旧介入のみ破棄。旧枝は無変更。同一 command の再送は `DUPLICATE`。範囲外 target・禁止 statPath は拒否し状態不変。
4. 総介入回数・PT に起因する制限/課金が存在しない。法的・結果状態の直接編集は拒否。
5. 出生枠 2 を B が 2 児に割当てても人口が二重増加しない。枠なしでは出生なし（Trace あり）。人口 1000・出生 20・自然死 16 → 1004、記名児 2 人でも 1004。
6. 同一 requestId の台帳取引は 1 回だけ適用。バッチは全件成立か全件拒否。⑤の予約兵と⑥の予約兵が Pool を超過しない。
7. 無信号なら家門支持割合が変化しない。不満 −15 のみで給付予算が移管されない。
8. 1349 年⑥の適法な条約は 1350 年判定へ反映、承認 PENDING なら勝利を偽装しない。年末戦死の Title holder は 1350 年に生存扱いされない。受益者が死者/他王朝の ControlMandate は勝利にならない。
9. 37 RuleID が一意で改名されず Registry から参照できる。未実装ルールが偽のイベントを発生させない。
10. 勝利条件テスト: 独立王＝成功／外国臣下の世襲所領＝成功／傍系の合法継承＝成功／血縁のみ・名目称号・CROWN のみ＝失敗。

## 10. 意図的に未確定の事項

`docs/spec/pending-approvals.md` を参照。判断前でも、状態型・ref 検証・照会 API・`PENDING`・厳格 Goal・トランザクション・固定 seed・GUI・テストフィクスチャは実装できる。**現行仕様を変える裁量規則や結果状態の自動補完は Claude Code の判断範囲外。**
