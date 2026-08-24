import { secureInt } from "./random.js?v=20260824-task14-production-r2";

const TRADITIONAL_PAIRS = [
  ["后", "後"], ["发", "發"], ["里", "裡"], ["云", "雲"], ["台", "臺"], ["万", "萬"], ["与", "與"], ["专", "專"], ["业", "業"], ["东", "東"],
  ["丝", "絲"], ["两", "兩"], ["严", "嚴"], ["丧", "喪"], ["个", "個"], ["丰", "豐"], ["临", "臨"], ["为", "為"], ["丽", "麗"], ["举", "舉"],
  ["义", "義"], ["乌", "烏"], ["乐", "樂"], ["乔", "喬"], ["习", "習"], ["乡", "鄉"], ["书", "書"], ["买", "買"], ["乱", "亂"], ["争", "爭"],
  ["于", "於"], ["亏", "虧"], ["亚", "亞"], ["产", "產"], ["亩", "畝"], ["亲", "親"], ["亿", "億"], ["仅", "僅"], ["从", "從"], ["仓", "倉"],
  ["仪", "儀"], ["们", "們"], ["优", "優"], ["会", "會"], ["伞", "傘"], ["伟", "偉"], ["传", "傳"], ["伤", "傷"], ["伦", "倫"], ["体", "體"],
  ["余", "餘"], ["佣", "傭"], ["侠", "俠"], ["侣", "侶"], ["侥", "僥"], ["侧", "側"], ["侦", "偵"], ["俭", "儉"], ["债", "債"], ["倾", "傾"],
  ["偿", "償"], ["储", "儲"], ["儿", "兒"], ["兑", "兌"], ["党", "黨"], ["兰", "蘭"], ["关", "關"], ["兴", "興"], ["养", "養"], ["兽", "獸"],
  ["内", "內"], ["冈", "岡"], ["册", "冊"], ["写", "寫"], ["军", "軍"], ["农", "農"], ["冲", "衝"], ["决", "決"], ["况", "況"], ["冻", "凍"],
  ["净", "淨"], ["凉", "涼"], ["减", "減"], ["凑", "湊"], ["凤", "鳳"], ["凭", "憑"], ["凯", "凱"], ["击", "擊"], ["划", "劃"], ["刘", "劉"],
  ["则", "則"], ["刚", "剛"], ["创", "創"], ["删", "刪"], ["别", "別"], ["刹", "剎"], ["制", "製"], ["剂", "劑"], ["剑", "劍"], ["剧", "劇"],
  ["办", "辦"], ["务", "務"], ["动", "動"], ["励", "勵"], ["劲", "勁"], ["劳", "勞"], ["势", "勢"], ["勋", "勳"], ["匀", "勻"], ["区", "區"],
  ["医", "醫"], ["华", "華"], ["协", "協"], ["单", "單"], ["卖", "賣"], ["卢", "盧"], ["卫", "衛"], ["却", "卻"], ["厅", "廳"], ["历", "歷"],
  ["压", "壓"], ["县", "縣"], ["参", "參"], ["双", "雙"], ["变", "變"], ["叙", "敘"], ["叶", "葉"], ["号", "號"], ["叹", "嘆"], ["听", "聽"],
  ["启", "啟"], ["吴", "吳"], ["员", "員"], ["呛", "嗆"], ["呜", "嗚"], ["咏", "詠"], ["咙", "嚨"], ["咸", "鹹"], ["响", "響"], ["哑", "啞"],
  ["哗", "嘩"], ["唇", "脣"], ["唤", "喚"], ["啸", "嘯"], ["喷", "噴"], ["嘱", "囑"], ["团", "團"], ["园", "園"], ["围", "圍"], ["国", "國"],
  ["图", "圖"], ["圆", "圓"], ["圣", "聖"], ["场", "場"], ["坏", "壞"], ["块", "塊"], ["坚", "堅"], ["坛", "壇"], ["坝", "壩"], ["坞", "塢"],
  ["垄", "壟"], ["垒", "壘"], ["垫", "墊"], ["埙", "塤"], ["堕", "墮"], ["墙", "牆"], ["壮", "壯"], ["声", "聲"], ["壳", "殼"], ["处", "處"],
  ["备", "備"], ["复", "復"], ["够", "夠"], ["头", "頭"], ["夹", "夾"], ["夺", "奪"], ["奋", "奮"], ["奖", "獎"], ["妇", "婦"], ["妈", "媽"],
  ["妆", "妝"], ["姗", "姍"], ["娱", "娛"], ["婴", "嬰"], ["孙", "孫"], ["学", "學"], ["宁", "寧"], ["宝", "寶"], ["实", "實"], ["宠", "寵"],
  ["审", "審"], ["宫", "宮"], ["宽", "寬"], ["宾", "賓"], ["对", "對"], ["寻", "尋"], ["导", "導"], ["寿", "壽"], ["将", "將"], ["尔", "爾"],
  ["尘", "塵"], ["尝", "嘗"], ["层", "層"], ["属", "屬"], ["岁", "歲"], ["岂", "豈"], ["岛", "島"], ["岭", "嶺"], ["岳", "嶽"], ["峡", "峽"],
  ["币", "幣"], ["帅", "帥"], ["师", "師"], ["帐", "帳"], ["帘", "簾"], ["带", "帶"], ["帮", "幫"], ["干", "幹"], ["并", "並"], ["广", "廣"],
  ["庆", "慶"], ["庐", "廬"], ["库", "庫"], ["应", "應"], ["庙", "廟"], ["废", "廢"], ["开", "開"], ["异", "異"], ["弃", "棄"], ["张", "張"],
  ["弥", "彌"], ["弯", "彎"], ["弹", "彈"], ["强", "強"], ["归", "歸"], ["录", "錄"], ["当", "當"], ["彻", "徹"], ["径", "徑"], ["忆", "憶"],
];

let openCcMaps = null;
let openCcMapsPromise = null;

export function fallbackChineseMaps() {
  return {
    traditional: new Map(TRADITIONAL_PAIRS),
    simple: new Map(TRADITIONAL_PAIRS.map(([simple, traditional]) => [traditional, simple])),
    source: "fallback",
  };
}

export function parseOpenCcCharacterDictionary(text) {
  const map = new Map();
  String(text || "").split(/\r?\n/).forEach((line) => {
    const value = line.trim();
    if (!value || value.startsWith("#")) return;
    const [source, rawTargets] = value.split("\t", 2);
    const target = String(rawTargets || "").trim().split(/\s+/)[0];
    if (source && target) map.set(source, target);
  });
  return map;
}

export function getOpenCcSource() {
  return openCcMaps?.source || "fallback";
}

export function loadOpenCcMaps(fetchStaticText) {
  if (openCcMaps) return Promise.resolve(openCcMaps);
  if (!openCcMapsPromise) {
    openCcMapsPromise = Promise.all([
      fetchStaticText("/vendor/opencc-st-characters.txt"),
      fetchStaticText("/vendor/opencc-ts-characters.txt"),
    ]).then(([simplifiedToTraditional, traditionalToSimplified]) => {
      const maps = {
        traditional: parseOpenCcCharacterDictionary(simplifiedToTraditional),
        simple: parseOpenCcCharacterDictionary(traditionalToSimplified),
        source: "opencc",
      };
      if (maps.traditional.size < 3000 || maps.simple.size < 3000) throw new Error("OpenCC 字符词典不完整");
      openCcMaps = maps;
      return maps;
    }).catch(() => {
      openCcMaps = fallbackChineseMaps();
      return openCcMaps;
    });
  }
  return openCcMapsPromise;
}

function textWords(text) {
  return String(text || "").normalize("NFKC").trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function caseWords(text) {
  return String(text || "").normalize("NFKC").replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((word) => word.toLocaleLowerCase());
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(String(value).replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function runTextOperation(toolId, input, secondary, parameter, option, documentRef = globalThis.document) {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  if (toolId === "text-stats") {
    const words = textWords(input).length;
    const cjkCharacters = (input.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
    const latinWords = textWords(input).filter((word) => !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)).length;
    const paragraphs = input.trim() ? input.trim().split(/\n\s*\n/).filter(Boolean).length : 0;
    const readingMinutes = input.trim() ? Math.max(1, Math.ceil(latinWords / 220 + cjkCharacters / 400)) : 0;
    return `字符（含空格）：${[...input].length}\n字符（不含空格）：${[...input.replace(/\s/g, "")].length}\n单词/连续词组：${words}\n中日韩字符：${cjkCharacters}\n行：${input ? lines.length : 0}\n段落：${paragraphs}\n预计阅读：${readingMinutes} 分钟`;
  }
  if (toolId === "dedupe-lines") return [...new Set(lines)].join("\n");
  if (toolId === "remove-empty-lines") return lines.filter((line) => line.trim()).join("\n");
  if (toolId === "collapse-spaces") return lines.map((line) => line.trim().replace(/[ \t\u3000]+/g, " ")).join("\n");
  if (toolId === "letter-case") return option === "lower" ? input.toLocaleLowerCase() : option === "title" ? input.replace(/\p{L}+/gu, (word) => word[0].toLocaleUpperCase() + word.slice(1).toLocaleLowerCase()) : input.toLocaleUpperCase();
  if (["camel-case", "pascal-case", "snake-case", "kebab-case"].includes(toolId)) {
    const words = caseWords(input);
    if (toolId === "snake-case") return words.join("_");
    if (toolId === "kebab-case") return words.join("-");
    return words.map((word, index) => (toolId === "camel-case" && index === 0) ? word : word[0]?.toLocaleUpperCase() + word.slice(1)).join("");
  }
  if (toolId === "line-prefix") return lines.map((line) => `${parameter}${line}`).join("\n");
  if (toolId === "line-suffix") return lines.map((line) => `${line}${parameter}`).join("\n");
  if (toolId === "line-numbers") return lines.map((line, index) => `${index + 1}${parameter || ". "}${line}`).join("\n");
  if (toolId === "find-replace") return input.split(parameter).join(secondary);
  if (toolId === "regex-replace") return input.replace(new RegExp(parameter, option || "g"), secondary);
  if (toolId === "sort-lines") return [...lines].sort((a, b) => option === "desc" ? b.localeCompare(a, "zh-CN", { numeric: true }) : a.localeCompare(b, "zh-CN", { numeric: true })).join("\n");
  if (toolId === "shuffle-lines") {
    const result = [...lines];
    for (let index = result.length - 1; index > 0; index -= 1) { const target = secureInt(0, index); [result[index], result[target]] = [result[target], result[index]]; }
    return result.join("\n");
  }
  if (toolId === "text-diff") {
    const right = secondary.replace(/\r\n?/g, "\n").split("\n");
    const cells = (lines.length + 1) * (right.length + 1);
    if (cells > 1_000_000) throw new Error("对比文本过长，请将两侧文本控制在约 1000 行以内");
    const width = right.length + 1;
    const matrix = new Uint16Array(cells);
    for (let leftIndex = lines.length - 1; leftIndex >= 0; leftIndex -= 1) {
      for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
        const offset = leftIndex * width + rightIndex;
        matrix[offset] = lines[leftIndex] === right[rightIndex]
          ? matrix[(leftIndex + 1) * width + rightIndex + 1] + 1
          : Math.max(matrix[(leftIndex + 1) * width + rightIndex], matrix[leftIndex * width + rightIndex + 1]);
      }
    }
    const result = [];
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < lines.length || rightIndex < right.length) {
      if (leftIndex < lines.length && rightIndex < right.length && lines[leftIndex] === right[rightIndex]) {
        result.push(`  ${lines[leftIndex]}`); leftIndex += 1; rightIndex += 1;
      } else if (rightIndex < right.length && (leftIndex >= lines.length || matrix[leftIndex * width + rightIndex + 1] >= matrix[(leftIndex + 1) * width + rightIndex])) {
        result.push(`+ ${right[rightIndex]}`); rightIndex += 1;
      } else {
        result.push(`- ${lines[leftIndex]}`); leftIndex += 1;
      }
    }
    return result.join("\n");
  }
  const extractors = {
    "extract-email": /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
    "extract-url": /https?:\/\/[^\s<>'"]+/gi,
    "extract-ip": /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    "extract-number-date": /(?:\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b)|(?:[-+]?\d+(?:\.\d+)?)/g,
  };
  if (extractors[toolId]) return [...new Set(input.match(extractors[toolId]) || [])].join("\n");
  if (toolId === "base64") return option === "decode" ? base64ToUtf8(input) : utf8ToBase64(input);
  if (toolId === "url-code") return option === "decode" ? decodeURIComponent(input) : encodeURIComponent(input);
  if (toolId === "html-entities") {
    if (option === "decode") { const area = documentRef.createElement("textarea"); area.innerHTML = input; return area.value; }
    return input.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }
  if (toolId === "unicode-code") {
    if (option === "decode") return input.replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})/gi, (_, wide, narrow) => String.fromCodePoint(parseInt(wide || narrow, 16)));
    return [...input].map((char) => { const code = char.codePointAt(0); return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`; }).join("");
  }
  if (toolId.startsWith("json-")) {
    const parsed = JSON.parse(input);
    if (toolId === "json-validate") return "JSON 合法\n根类型：" + (Array.isArray(parsed) ? "数组" : typeof parsed);
    return JSON.stringify(parsed, null, toolId === "json-format" ? 2 : 0);
  }
  if (toolId === "chinese-convert") {
    const maps = openCcMaps || fallbackChineseMaps();
    const map = option === "traditional" ? maps.traditional : maps.simple;
    return [...input].map((char) => map.get(char) || char).join("");
  }
  return input;
}
