import { normalizeWord } from "./task15-model.mjs";

const ENGLISH_LEVELS = Object.freeze({
  primary_3: ["小学三年级", `apple bag bed bird black blue book boy cake cat chair class clock close cold colour come dad desk dog door draw drink ear egg eight eye face family father fish five flower four friend girl go good green hand happy head hello help home hot house how I jump key leg like look love lunch map milk mother name nine nose one open orange pen pencil pig play please red rice run school seven sing sister six small stand student teacher ten thank three tiger two walk water white window yellow you zoo`],
  primary_4: ["小学四年级", `afternoon animal answer art baby bathroom beautiful bedroom breakfast brother brown bus busy buy camera canteen car classroom clean clothes computer cook dinner doctor dress driver early evening farmer floor food football garden glasses great gym hair homework horse hospital hungry jacket kitchen library light living long maths morning music nurse parent picture playground read right river ruler science sheep short skirt sleep sock song speak story strong study sunny table tall these those today tree trousers uncle warm wash watch weather welcome whose woman`],
  primary_5: ["小学五年级", `always autumn because begin beside bottle bridge bring building catch children clever cloudy collect country dance delicious different difficult enjoy favourite festival first forest Friday front game gift give healthy holiday kind lake language later listen market Monday mountain museum often park party people plant polite pretty question quiet rainy remember Saturday season second show sometimes spring station summer Sunday supermarket swim Thursday together Tuesday usually village Wednesday weekend winter world write year yesterday`],
  primary_6: ["小学六年级", `abroad airport amazing arrive beach before bicycle cinema city climb comic concert dictionary direction east email exciting exercise famous film finish future hobby hotel idea important interesting internet journey learn leave lesson letter message minute moon newspaper north office passport past present problem race restaurant robot save shop south space special start street theatre ticket travel trip useful visit west winner wonderful worry`],
  middle_1: ["初中一年级", `activity age also apartment basketball borrow calendar celebrate center club complete conversation cousin culture daily decide describe diary during each everyone example expensive experience explain friendly geography habit history hundred invite join local lucky magazine member movie never number practice prepare price really reason report result rule subject surprise team thousand traditional vacation volunteer weekday young`],
  middle_2: ["初中二年级", `advice although appear article attention average avoid believe care character choice communication competition continue control creative deal develop difference environment fact formal finally follow foreign improve instead knowledge least lonely meaning mind nature necessary notice opinion perfect perhaps population possible protect public relationship serious service several similar situation society successful technology through trust`],
  middle_3: ["初中三年级", `ability achieve advantage allow ancient cause certain challenge common condition connect consider courage create decision discover education effort energy especially event influence information introduce invention manage method mistake modern opportunity organize patient perform pressure progress project purpose receive reduce research respect responsibility solve standard suggest support value whether`],
  high_1: ["高中一年级", `academic adapt attitude benefit campaign career comment compare concern conduct confident contact context contribute custom demand determine economic effective emotion establish feature focus function global identity independent individual industry inspire issue maintain material measure mental occur particular positive process range recognize resource respond significant solution specific strategy structure`],
  high_2: ["高中二年级", `access approach assume aware capacity circumstance complex concept consequence convey contrast convince cooperate critical define demonstrate despite element engage evaluate evidence expand factor flexible impact indicate interpret involve likely motivate obtain perspective principle promote recover relevant require role secure select source theory transfer various`],
  high_3: ["高中三年级", `advocate alternative analyse anticipate appropriate argument assess authority brief clarify conflict consistent consult contemporary criteria decline domestic emerge emphasis ensure ethical generate implement imply initial insight integrate justify legal mechanism outcome priority professional proportion react regulate resolve restrict retain shift stable valid`],
  cet_4: ["大学英语四级", `abandon absolute absorb abstract accompany accurate acquire adequate adjust administration adopt afford apparent appeal application appoint appreciate approximately atmosphere attach available allocate barrier category combination commercial commit communicate compensate concentrate conclude considerable constant construct consume convention declare efficient estimate exposure finance fundamental guarantee investigate modify potential primary procedure`],
  cet_6: ["大学英语六级", `abolish abrupt accumulate acknowledge adjacent ambiguous analogy arbitrary articulate attain attribute authentic autonomous coherent coincide compile comprehensive concede contemplate contradict controversy crucial cumulative deteriorate dilemma discriminate elaborate empirical equivalent facilitate formulate hypothesis inevitable inherent manipulate marginal nevertheless paradox preliminary profound reinforce reluctant sophisticated subordinate supplement tentative trigger undermine`],
});

const JAPANESE_LEVELS = Object.freeze({
  n5: ["JLPT N5", `私 あなた 人 子供 先生 学生 学校 本 水 火 木 金 土 日 月 年 時 今日 明日 昨日 朝 昼 夜 毎日 家 部屋 机 椅子 車 電車 駅 道 店 会社 友達 父 母 兄 姉 弟 妹 犬 猫 魚 肉 野菜 果物 ご飯 お茶 コーヒー 行く 来る 帰る 食べる 飲む 見る 聞く 話す 読む 書く 買う 大きい 小さい 新しい 古い 良い 悪い 暑い 寒い 上 下 左 右`],
  n4: ["JLPT N4", `会議 受付 住所 運転 海岸 会場 関係 季節 急行 教育 近所 経験 工場 交通 高校 公園 国際 最近 産業 試合 事故 自由 習慣 準備 紹介 招待 将来 食事 新聞 世界 説明 相談 卒業 大切 台風 地下鉄 注意 駐車場 都合 特別 入院 発音 必要 文化 返事 法律 約束 予定 連絡 安全 以外 一度 残念 十分 親切 簡単 複雑 続ける 間に合う`],
  n3: ["JLPT N3", `愛情 安定 意識 一般 印象 営業 影響 援助 応募 改善 確認 活動 完成 管理 期待 記録 技術 議論 協力 具体 結果 健康 現在 原因 効果 行動 国民 作業 支援 事実 実際 社会 収入 状況 情報 信頼 成功 責任 選択 対象 態度 地域 調査 能力 判断 方法 目的 利用 理解 連続 重要 適切 積極的 豊か 深刻 増加 減少 解決 進める`],
  n2: ["JLPT N2", `圧倒 安易 維持 一致 運営 衛生 応用 解釈 確保 革新 環境 観測 基準 義務 供給 競争 強調 傾向 契約 貢献 構成 雇用 採用 資源 実施 需要 条件 推進 制度 成果 政策 専門 組織 対策 達成 調整 提供 適用 展開 統計 導入 独立 背景 評価 普及 分析 変化 方針 予測 要求 論理 柔軟 慎重 著しい 伴う 防ぐ 促す 認める`],
  n1: ["JLPT N1", `暗黙 威厳 一括 逸脱 概念 還元 規範 脅威 局面 均衡 経緯 権限 顕著 原則 源泉 控除 根拠 錯覚 指針 趣旨 収束 循環 措置 妥当 抽象 秩序 追及 定義 展望 動向 認識 配慮 反響 比率 複合 本質 枠組み 矛盾 優位 抑制 倫理 類推 論点 簡潔 緻密 謙虚 壮大 甚だしい 覆す 踏まえる 損なう 遂げる 顧みる 免れる 促進`],
});

const LEVELS = Object.freeze({ english: ENGLISH_LEVELS, japanese: JAPANESE_LEVELS });
const LEVEL_ORDER = Object.freeze({
  english: Object.keys(ENGLISH_LEVELS),
  japanese: Object.keys(JAPANESE_LEVELS),
});

export const COMMON_RUBRICS = Object.freeze({
  apple: { language: "英语", gloss: "苹果", accepted: ["苹果"], notes: "常用名词", reading: "" },
  book: { language: "英语", gloss: "书", accepted: ["书本", "书籍"], notes: "常用名词", reading: "" },
  cat: { language: "英语", gloss: "猫", accepted: ["猫咪"], notes: "常用名词", reading: "" },
  dog: { language: "英语", gloss: "狗", accepted: ["犬"], notes: "常用名词", reading: "" },
  flower: { language: "英语", gloss: "花", accepted: ["花朵", "花卉"], notes: "常用名词", reading: "" },
  green: { language: "英语", gloss: "绿色", accepted: ["绿"], notes: "颜色", reading: "" },
  hello: { language: "英语", gloss: "你好", accepted: ["您好", "喂"], notes: "常用问候语", reading: "" },
  house: { language: "英语", gloss: "房子", accepted: ["住宅", "房屋"], notes: "常用名词", reading: "" },
  idea: { language: "英语", gloss: "想法", accepted: ["主意", "观念"], notes: "常用名词", reading: "" },
  light: { language: "英语", gloss: "光", accepted: ["灯", "光线", "轻的"], notes: "常见义项", reading: "" },
  music: { language: "英语", gloss: "音乐", accepted: ["乐曲"], notes: "常用名词", reading: "" },
  orange: { language: "英语", gloss: "橙子", accepted: ["橘子", "橙色"], notes: "常见义项", reading: "" },
  school: { language: "英语", gloss: "学校", accepted: ["校园"], notes: "常用名词", reading: "" },
  world: { language: "英语", gloss: "世界", accepted: ["世间"], notes: "常用名词", reading: "" },
  "電話": { language: "日语", gloss: "电话", accepted: ["电话机"], notes: "常用名词", reading: "でんわ" },
  "でんわ": { language: "日语", gloss: "电话", accepted: ["电话机"], notes: "常用名词", reading: "でんわ" },
  "花": { language: "日语", gloss: "花", accepted: ["花朵", "花卉"], notes: "常用名词", reading: "はな" },
  "はな": { language: "日语", gloss: "花", accepted: ["花朵", "花卉"], notes: "常用名词", reading: "はな" },
  "水": { language: "日语", gloss: "水", accepted: ["水分"], notes: "常用名词", reading: "みず" },
  "みず": { language: "日语", gloss: "水", accepted: ["水分"], notes: "常用名词", reading: "みず" },
  "アドバイザー": { language: "日语", gloss: "顾问", accepted: ["咨询顾问"], notes: "外来语", reading: "アドバイザー" },
});

export const COMMON_JAPANESE_FORMS = Object.freeze({
  "電話": ["でんわ", "電話"], "でんわ": ["でんわ", "電話"],
  "花": ["はな", "花"], "はな": ["はな", "花"],
  "水": ["みず", "水"], "みず": ["みず", "水"],
  "山": ["やま", "山"], "やま": ["やま", "山"],
  "目": ["め", "目"], "め": ["め", "目"],
  "手": ["て", "手"], "て": ["て", "手"],
  "言葉": ["ことば", "言葉"], "ことば": ["ことば", "言葉"],
  "家族": ["かぞく", "家族"], "かぞく": ["かぞく", "家族"],
  "部屋": ["へや", "部屋"], "へや": ["へや", "部屋"],
  "雪": ["ゆき", "雪"], "ゆき": ["ゆき", "雪"],
  "音楽": ["おんがく", "音楽"], "おんがく": ["おんがく", "音楽"],
  "アドバイザー": ["アドバイザー", "アドバイザー"],
});

function wordsFor(language, level) {
  const entry = LEVELS[language]?.[level];
  return entry ? entry[1].trim().split(/\s+/u) : [];
}

function morphologyKeys(value) {
  const output = new Set([value]);
  if (value.length > 4 && value.endsWith("ies")) output.add(`${value.slice(0, -3)}y`);
  if (value.length > 3 && value.endsWith("es")) output.add(value.slice(0, -2));
  if (value.length > 3 && value.endsWith("s")) output.add(value.slice(0, -1));
  if (value.length > 5 && value.endsWith("ing")) {
    const stem = value.slice(0, -3);
    output.add(stem); output.add(`${stem}e`);
    if (stem.at(-1) === stem.at(-2)) output.add(stem.slice(0, -1));
  }
  if (value.length > 4 && value.endsWith("ed")) {
    const stem = value.slice(0, -2);
    output.add(stem); output.add(`${stem}e`);
    if (stem.at(-1) === stem.at(-2)) output.add(stem.slice(0, -1));
  }
  return output;
}

function levenshtein(left, right) {
  const a = Array.from(left); const b = Array.from(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return row[b.length];
}

function scoreMatch(word, query, language) {
  const normalized = normalizeWord(word, language);
  if (!query) return [500, "level"];
  if (normalized === query) return [1000, "exact"];
  if (normalized.startsWith(query)) return [900 - Math.min(100, normalized.length - query.length), "prefix"];
  if (language === "english") {
    const roots = morphologyKeys(normalized);
    if ([...morphologyKeys(query)].some((item) => roots.has(item))) return [790, "morphology"];
  }
  const maximum = Math.max(Array.from(query).length, Array.from(normalized).length);
  const ratio = maximum ? 1 - (levenshtein(query, normalized) / maximum) : 0;
  const minimum = maximum <= 7 ? 0.72 : 0.66;
  return ratio >= minimum ? [Math.floor(600 * ratio), "fuzzy"] : [0, ""];
}

export function vocabularyLevelExists(language, level) {
  return Boolean(LEVELS[language]?.[level]);
}

export function vocabularyLevelLabel(language, level) {
  return LEVELS[language]?.[level]?.[0] || "";
}

export function searchVocabulary(language, level, query = "", count = 15, exclude = []) {
  if (!vocabularyLevelExists(language, level)) return [];
  const normalizedQuery = normalizeWord(query, language);
  const seen = new Set((exclude || []).map((word) => normalizeWord(word, language)).filter(Boolean));
  const rank = (candidateLevel, adjacent = false) => wordsFor(language, candidateLevel)
    .map((word, position) => {
      const [rawScore, rawType] = scoreMatch(word, normalizedQuery, language);
      const score = adjacent && rawScore ? Math.min(rawScore, normalizedQuery ? 350 : 180) : rawScore;
      return { word, level: candidateLevel, position, score, match_type: adjacent ? `adjacent_${rawType || "level"}` : rawType };
    })
    .filter((item) => item.score && !seen.has(normalizeWord(item.word, language)))
    .sort((left, right) => right.score - left.score || left.position - right.position);

  const output = [];
  for (const item of rank(level)) {
    const key = normalizeWord(item.word, language);
    if (seen.has(key)) continue;
    seen.add(key); output.push(item);
    if (output.length >= count) return output;
  }
  const order = LEVEL_ORDER[language];
  const index = order.indexOf(level);
  const adjacent = [order[index - 1], order[index + 1]].filter(Boolean);
  for (const candidate of adjacent) {
    for (const item of rank(candidate, true)) {
      const key = normalizeWord(item.word, language);
      if (seen.has(key)) continue;
      seen.add(key); output.push(item);
      if (output.length >= count) return output;
    }
  }
  return output;
}
