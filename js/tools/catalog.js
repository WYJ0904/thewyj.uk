export const CATEGORY_DEFINITIONS = [
  { id: "text", name: "文本处理工具箱", description: "清理、转换、提取、编码与 JSON 处理" },
  { id: "file", name: "文件处理中心", description: "哈希、转换、拆分、合并、PDF 与 ZIP" },
  { id: "image", name: "图片与设计工具", description: "压缩、格式、尺寸、裁剪、水印与配色" },
  { id: "random", name: "随机生成器中心", description: "安全密码、抽签、分组、颜色、日期与骰子" },
  { id: "temporary", name: "临时工具", description: "临时文本、文件、剪贴板、二维码与留言房间" },
];

export const ICON_PATHS = {
  text: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-5 4 4 2-2 5 5"/>',
  random: '<path d="M4 7h3l10 10h3"/><path d="m17 14 3 3-3 3M4 17h3l3-3M14 10l3-3h3M17 4l3 3-3 3"/>',
  temporary: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bookmark: '<path d="M7 4h10v16l-5-3-5 3z"/>',
  delete: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6M10 11v5m4-5v5"/>',
};

export const iconSvg = (name, className = "ui-icon") => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ""}</svg>`;

export const toolRows = {
  text: [
    ["text-stats", "文本统计", "统计字符、单词、行数、段落和预计阅读时间。", "字数 计数 阅读时长"],
    ["dedupe-lines", "删除重复行", "按首次出现顺序移除完全相同的行。", "去重 唯一行"],
    ["remove-empty-lines", "删除空行", "清除空白行并保留有内容的行。", "空白行 清理"],
    ["collapse-spaces", "合并多余空格", "把连续空格和制表符整理为单个空格。", "空白 压缩"],
    ["letter-case", "大小写转换", "在全大写、全小写和标题格式之间切换。", "英文 字母"],
    ["camel-case", "camelCase 转换", "把词组转换为首词小写的驼峰命名。", "驼峰 变量名"],
    ["pascal-case", "PascalCase 转换", "把词组转换为每个单词首字母大写的命名。", "大驼峰 类名"],
    ["snake-case", "snake_case 转换", "把词组转换为下划线连接的命名。", "下划线 变量名"],
    ["kebab-case", "kebab-case 转换", "把词组转换为短横线连接的命名。", "短横线 css"],
    ["line-prefix", "批量添加前缀", "在每一行开头批量加入指定内容。", "行首"],
    ["line-suffix", "批量添加后缀", "在每一行末尾批量加入指定内容。", "行尾"],
    ["line-numbers", "批量添加行号", "为每一行自动添加连续编号。", "编号 序号"],
    ["find-replace", "查找和替换", "查找普通文本并批量替换为新内容。", "替换文字"],
    ["regex-replace", "正则表达式替换", "使用正则表达式完成高级批量替换。", "regexp pattern"],
    ["sort-lines", "文本排序", "按字母、数字或倒序重新排列文本行。", "排序 行"],
    ["shuffle-lines", "文本随机排序", "随机打乱所有文本行的顺序。", "洗牌 打乱"],
    ["text-diff", "文本差异对比", "逐行标出两段文本新增、删除和相同内容。", "比较 diff"],
    ["extract-email", "提取邮箱", "从混合文本中识别并列出电子邮箱地址。", "邮件 email"],
    ["extract-url", "提取 URL", "从文本中识别并列出 HTTP 或 HTTPS 链接。", "网址 链接"],
    ["extract-ip", "提取 IP 地址", "从文本中提取格式有效的 IPv4 地址。", "ipv4 网络地址"],
    ["extract-number-date", "提取数字和日期", "提取文本中的数字及常见日期格式。", "数值 时间"],
    ["base64", "Base64 编码与解码", "在普通文本与 Base64 内容之间双向转换。", "编码 解码"],
    ["url-code", "URL 编码与解码", "编码或还原网址参数中的特殊字符。", "uri 百分号"],
    ["html-entities", "HTML 实体编码与解码", "转义或还原 HTML 中的特殊字符实体。", "网页 转义"],
    ["unicode-code", "Unicode 转换", "在可读文字与 Unicode 转义序列之间转换。", "字符 转义"],
    ["json-format", "JSON 格式化", "校验并缩进 JSON，便于阅读和排查。", "美化 pretty"],
    ["json-minify", "JSON 压缩", "移除 JSON 中不必要的空白和换行。", "紧凑 minify"],
    ["json-validate", "JSON 合法性检查", "检查 JSON 语法并定位无法解析的内容。", "校验 validate"],
    ["chinese-convert", "简繁体转换", "使用本地 OpenCC 字符词典双向转换简体与繁体。", "简体 繁体 中文"],
  ],
  file: [
    ["file-md5", "MD5 计算", "在本地计算文件的 MD5 校验值。", "哈希 hash 校验"],
    ["file-sha1", "SHA-1 计算", "在本地计算文件的 SHA-1 校验值。", "哈希 hash 校验"],
    ["file-sha256", "SHA-256 计算", "在本地计算文件的 SHA-256 校验值。", "哈希 hash 校验"],
    ["file-sha512", "SHA-512 计算", "在本地计算文件的 SHA-512 校验值。", "哈希 hash 校验"],
    ["file-info", "文件基本信息", "查看文件名、类型、大小和最后修改时间。", "属性 元数据"],
    ["csv-json", "CSV 转 JSON", "把 CSV 表格解析为结构化 JSON 数组。", "表格 数据转换"],
    ["json-csv", "JSON 转 CSV", "把对象数组转换为可下载的 CSV 表格。", "表格 数据转换"],
    ["text-encoding", "文本编码转换", "读取常见文本编码并输出 UTF-8 文件。", "utf8 字符集"],
    ["text-split", "文本文件分割", "按指定行数拆分大型文本文件。", "切分 txt"],
    ["csv-split", "CSV 文件分割", "保留表头并按数据行数拆分 CSV。", "切分 表格"],
    ["txt-merge", "TXT 文件合并", "按选择顺序合并多个 TXT 文件。", "拼接 文本"],
    ["csv-merge", "CSV 文件合并", "合并表头一致的多个 CSV 文件。", "拼接 表格"],
    ["json-array-merge", "JSON 数组合并", "把多个 JSON 数组合并为一个数组文件。", "拼接 数据"],
    ["images-pdf", "多张图片转 PDF", "按选择顺序把多张图片生成多页 PDF。", "照片 文档"],
    ["rename-preview", "批量重命名预览", "生成批量新文件名清单，不修改原文件。", "改名 文件名"],
    ["files-zip", "文件打包为 ZIP", "把选中的文件在本地打包成一个 ZIP。", "压缩包 打包"],
    ["batch-zip", "批量 ZIP 下载", "把多个文件整理打包后一次下载。", "压缩包 批量"],
  ],
  image: [
    ["image-compress", "图片压缩", "调整格式和质量以减小单张图片体积。", "压图 质量"],
    ["image-batch-compress", "批量图片压缩", "一次压缩多张图片并打包下载。", "压图 多图"],
    ["image-format", "PNG、JPG、WebP 转换", "在 PNG、JPG 和 WebP 格式之间转换。", "格式 转图"],
    ["image-resize", "图片尺寸调整", "按指定像素宽高重新生成图片。", "改尺寸 像素"],
    ["image-scale", "按百分比缩放", "按百分比等比例放大或缩小图片。", "比例 缩图"],
    ["image-crop", "图片裁剪", "按百分比坐标裁出指定矩形区域。", "剪裁 截取"],
    ["crop-square", "1:1 裁剪", "从图片中央裁出正方形区域。", "方形 头像"],
    ["crop-four-three", "4:3 裁剪", "从图片中央裁出 4:3 比例画面。", "四比三"],
    ["crop-sixteen-nine", "16:9 裁剪", "从图片中央裁出 16:9 宽屏画面。", "宽屏 十六比九"],
    ["image-rotate", "图片旋转", "把图片旋转 90、180 或 270 度。", "方向 转向"],
    ["image-flip", "图片翻转", "按水平、垂直或双向镜像翻转图片。", "镜像"],
    ["image-rounded", "图片圆角", "为图片四角添加可调透明圆角。", "圆角 半径"],
    ["image-avatar", "圆形头像", "把图片中央区域裁成透明圆形头像。", "头像 圆图"],
    ["text-watermark", "文本水印", "在图片右下角添加半透明文字水印。", "署名 版权"],
    ["image-watermark", "图片水印", "在主图右下角叠加另一张图片。", "logo 叠图"],
    ["tile-watermark", "平铺水印", "在整张图片上重复铺设文字水印。", "满屏 防盗图"],
    ["image-mosaic", "马赛克", "为指定矩形区域添加像素化马赛克。", "打码 隐私"],
    ["image-blur", "高斯模糊", "为整张图片添加可调强度模糊。", "虚化 blur"],
    ["image-redact", "黑色遮挡", "用纯黑矩形永久遮挡指定区域。", "涂黑 隐私"],
    ["image-pdf", "图片转 PDF", "把选中的图片按顺序生成 PDF 文档。", "照片 文档"],
    ["exif-view", "EXIF 信息查看", "本地查看 JPEG 的相机、时间、方向和 GPS 标签。", "元数据 相机"],
    ["exif-remove", "EXIF 信息删除", "清除图片元数据；JPEG 不重新压缩像素。", "隐私 清除"],
    ["gps-warning", "GPS 隐私提醒", "检测 JPEG 中可能泄露位置的 GPS 标签。", "定位 经纬度"],
    ["color-extract", "图片颜色提取", "从图片中提取最多八种主要颜色。", "配色 主色"],
    ["color-convert", "HEX、RGB 和 HSL 取色", "输入任一 HEX、RGB 或 HSL 颜色并互相转换。", "颜色代码"],
    ["gradient-generator", "渐变背景生成器", "生成指定尺寸、颜色和角度的渐变图片。", "背景 渐变图"],
    ["gradient-css", "CSS 渐变代码生成", "预览渐变并生成可复制的 CSS 代码。", "linear-gradient 样式"],
    ["solid-image", "纯色图片生成器", "生成指定尺寸和颜色的纯色 PNG。", "背景 色块"],
    ["favicon-generator", "Favicon 生成器", "把图片缩放为适合网页图标的 32×32 PNG。", "网站图标 ico"],
    ["multi-icon-zip", "多尺寸图标 ZIP 下载", "生成 16 到 512 像素的七种 PNG 图标。", "应用图标 icon"],
  ],
  random: [
    ["random-integer", "随机数字", "在指定最小值和最大值之间生成整数。", "整数 数字"],
    ["random-decimal", "随机小数", "在指定范围内生成随机小数。", "浮点 数字"],
    ["random-string", "随机字符串", "按指定长度和字符集生成随机文本。", "字符 token"],
    ["random-password", "安全密码生成器", "用安全随机数和可选字符类型生成高强度密码。", "口令 密钥"],
    ["random-uuid", "UUID v4 生成器", "生成符合 UUID v4 格式的随机标识符。", "guid 标识"],
    ["random-draw", "随机抽签", "从候选名单中公平抽取一个结果。", "抽奖 点名"],
    ["random-groups", "随机分组", "把名单打乱后平均分配到多个小组。", "分队 分班"],
    ["random-wheel", "随机转盘", "从多个选项中模拟转盘选出结果。", "轮盘 选择"],
    ["weighted-wheel", "带权重转盘", "按照每个选项的权重概率抽取结果。", "概率 加权"],
    ["random-date", "随机日期", "在指定起止日期之间随机选择一天。", "日历 日期"],
    ["random-time", "随机时间", "随机生成一天中的小时、分钟和秒。", "时钟"],
    ["random-color", "随机颜色", "生成一个随机 HEX 颜色值。", "取色 色值"],
    ["random-palette", "随机调色板", "一次生成多种随机颜色组成的配色表。", "色板 配色"],
    ["coin-flip", "抛硬币", "随机返回正面或反面。", "硬币 二选一"],
    ["dice-d4", "D4 骰子", "投掷一枚四面骰子。", "桌游 骰子"],
    ["dice-d6", "D6 骰子", "投掷一枚六面骰子。", "桌游 骰子"],
    ["dice-d8", "D8 骰子", "投掷一枚八面骰子。", "桌游 骰子"],
    ["dice-d10", "D10 骰子", "投掷一枚十面骰子。", "桌游 骰子"],
    ["dice-d12", "D12 骰子", "投掷一枚十二面骰子。", "桌游 骰子"],
    ["dice-d20", "D20 骰子", "投掷一枚二十面骰子。", "桌游 骰子"],
    ["custom-dice", "自定义骰子", "设置面数后投掷自定义骰子。", "随机数 面数"],
    ["random-decision", "随机决定器", "在多个方案之间随机帮你做决定。", "选择 困难"],
  ],
  temporary: [
    ["temporary-text", "临时文本分享", "创建带密码、过期和访问次数限制的文本链接。", "阅后即焚 分享"],
    ["temporary-file", "临时文件分享", "创建有期限和下载次数限制的文件链接。", "传文件 下载"],
    ["temporary-clipboard", "临时剪贴板", "用六位连接码在设备间临时传递文本。", "跨设备 复制"],
    ["temporary-qr", "临时二维码", "生成文本、网址、Wi-Fi、联系人或动态失效二维码。", "扫码 qr"],
    ["temporary-room", "临时留言房间", "创建无公开列表、可加密码的限时留言房间。", "聊天室 留言"],
  ],
};

export const TOOLS = Object.entries(toolRows).flatMap(([category, rows]) => rows.map(([id, name, description, aliases = ""]) => ({
  id, name, description, aliases, category,
})));
export const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.id, tool]));
export const CATEGORY_MAP = new Map(CATEGORY_DEFINITIONS.map((category) => [category.id, category]));

export function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function boundedEditDistance(left, right, limit = 2) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    let rowMinimum = current[0];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const cost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + cost,
      ));
      rowMinimum = Math.min(rowMinimum, current[rightIndex + 1]);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

function isSubsequence(needle, haystack) {
  if (!needle) return true;
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function isAdjacentTransposition(left, right) {
  if (left.length !== right.length) return false;
  const differences = [];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) differences.push(index);
  }
  return differences.length === 2
    && differences[1] === differences[0] + 1
    && left[differences[0]] === right[differences[1]]
    && left[differences[1]] === right[differences[0]];
}

TOOLS.forEach((tool) => {
  const category = CATEGORY_MAP.get(tool.category);
  tool.searchTerms = [tool.name, tool.description, tool.aliases, tool.id, category?.name || ""]
    .map(normalizeSearch)
    .filter(Boolean);
  tool.searchText = tool.searchTerms.join(" ");
});

export function fuzzyToolScore(tool, query) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return 1;
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  let total = tool.searchText.includes(normalizedQuery) ? 100 : 0;
  for (const token of queryTokens) {
    const compactToken = token.replace(/\s/g, "");
    let tokenScore = 0;
    for (const term of tool.searchTerms) {
      const compactTerm = term.replace(/\s/g, "");
      if (term === token) tokenScore = Math.max(tokenScore, 90);
      else if (term.startsWith(token)) tokenScore = Math.max(tokenScore, 72);
      else if (term.includes(token) || compactTerm.includes(compactToken)) tokenScore = Math.max(tokenScore, 60);
      for (const word of term.split(" ")) {
        if (compactToken.length >= 2 && word.length <= compactToken.length + 3 && isSubsequence(compactToken, word)) {
          tokenScore = Math.max(tokenScore, 38);
        }
        if (isAdjacentTransposition(compactToken, word)) tokenScore = Math.max(tokenScore, 64);
        const limit = token.length >= 6 ? 2 : 1;
        if (token.length >= 3 && boundedEditDistance(token, word, limit) <= limit) tokenScore = Math.max(tokenScore, 54);
      }
    }
    if (!tokenScore) return 0;
    total += tokenScore;
  }
  const primaryTerms = [tool.name, tool.id, tool.aliases]
    .map(normalizeSearch)
    .flatMap((term) => term.split(" "))
    .filter(Boolean);
  for (const token of queryTokens) {
    if (primaryTerms.some((term) => term.includes(token))) total += 55;
    else if (primaryTerms.some((term) => isAdjacentTransposition(token, term))) total += 72;
    else {
      const limit = token.length >= 6 ? 2 : 1;
      if (token.length >= 3 && primaryTerms.some((term) => boundedEditDistance(token, term, limit) <= limit)) {
        total += 45;
      }
    }
  }
  if (normalizeSearch(tool.name).includes(normalizedQuery)) total += 35;
  return total;
}

export function searchTools(query = "", category = "all") {
  const candidates = TOOLS.filter((tool) => category === "all" || tool.category === category);
  if (!normalizeSearch(query)) return candidates;
  return candidates
    .map((tool) => ({ tool, score: fuzzyToolScore(tool, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name, "zh-CN"))
    .map((item) => item.tool);
}
