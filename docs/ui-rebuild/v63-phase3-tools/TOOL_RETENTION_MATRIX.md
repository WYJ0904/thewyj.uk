# Aeris V6.3 Phase 3 — 全工具功能保留矩阵（104 注册 / 103 可见目录）

> **计数核实结论**：工具注册表 TOOLS 共 **104** 项，其中 	emporary-file 为 Task 24.1 合法退役的旧分享别名（保留在 TOOL_MAP 中以便旧链接/收藏重定向至规范 /transfer 文件传输页），可见目录 CATALOG_TOOLS 为 **103** 项（文本 29 + 文件 17 + 图片 30 + 随机 22 + 临时 5 = 103）。未删除、隐藏或伪造任何工具计数。

| # | Tool ID | 名称 | 分类 | 目录可见 | 图标语义 | 新版工作区布局 | 路由入口 | 自动化契约 |
|---|---|---|---|---|---|---|---|---|
| 1 | text-stats | 文本统计 | 文本处理 | 可见（目录网格） | text | split-editor | /tools/text-stats | unctional_audit_gate + 	est_tools_js PASS |
| 2 | dedupe-lines | 删除重复行 | 文本处理 | 可见（目录网格） | text | split-editor | /tools/dedupe-lines | unctional_audit_gate + 	est_tools_js PASS |
| 3 | remove-empty-lines | 删除空行 | 文本处理 | 可见（目录网格） | text | split-editor | /tools/remove-empty-lines | unctional_audit_gate + 	est_tools_js PASS |
| 4 | collapse-spaces | 合并多余空格 | 文本处理 | 可见（目录网格） | text | split-editor | /tools/collapse-spaces | unctional_audit_gate + 	est_tools_js PASS |
| 5 | letter-case | 大小写转换 | 文本处理 | 可见（目录网格） | case | split-editor | /tools/letter-case | unctional_audit_gate + 	est_tools_js PASS |
| 6 | camel-case | camelCase 转换 | 文本处理 | 可见（目录网格） | case | split-editor | /tools/camel-case | unctional_audit_gate + 	est_tools_js PASS |
| 7 | pascal-case | PascalCase 转换 | 文本处理 | 可见（目录网格） | case | split-editor | /tools/pascal-case | unctional_audit_gate + 	est_tools_js PASS |
| 8 | snake-case | snake_case 转换 | 文本处理 | 可见（目录网格） | case | split-editor | /tools/snake-case | unctional_audit_gate + 	est_tools_js PASS |
| 9 | kebab-case | kebab-case 转换 | 文本处理 | 可见（目录网格） | case | split-editor | /tools/kebab-case | unctional_audit_gate + 	est_tools_js PASS |
| 10 | line-prefix | 批量添加前缀 | 文本处理 | 可见（目录网格） | text | split-editor | /tools/line-prefix | unctional_audit_gate + 	est_tools_js PASS |
| 11 | line-suffix | 批量添加后缀 | 文本处理 | 可见（目录网格） | text | split-editor | /tools/line-suffix | unctional_audit_gate + 	est_tools_js PASS |
| 12 | line-numbers | 批量添加行号 | 文本处理 | 可见（目录网格） | text | split-editor | /tools/line-numbers | unctional_audit_gate + 	est_tools_js PASS |
| 13 | find-replace | 查找和替换 | 文本处理 | 可见（目录网格） | search | split-editor | /tools/find-replace | unctional_audit_gate + 	est_tools_js PASS |
| 14 | regex-replace | 正则表达式替换 | 文本处理 | 可见（目录网格） | search | split-editor | /tools/regex-replace | unctional_audit_gate + 	est_tools_js PASS |
| 15 | sort-lines | 文本排序 | 文本处理 | 可见（目录网格） | sort | split-editor | /tools/sort-lines | unctional_audit_gate + 	est_tools_js PASS |
| 16 | shuffle-lines | 文本随机排序 | 文本处理 | 可见（目录网格） | sort | split-editor | /tools/shuffle-lines | unctional_audit_gate + 	est_tools_js PASS |
| 17 | text-diff | 文本差异对比 | 文本处理 | 可见（目录网格） | diff | split-editor | /tools/text-diff | unctional_audit_gate + 	est_tools_js PASS |
| 18 | extract-email | 提取邮箱 | 文本处理 | 可见（目录网格） | extract | split-editor | /tools/extract-email | unctional_audit_gate + 	est_tools_js PASS |
| 19 | extract-url | 提取 URL | 文本处理 | 可见（目录网格） | extract | split-editor | /tools/extract-url | unctional_audit_gate + 	est_tools_js PASS |
| 20 | extract-ip | 提取 IP 地址 | 文本处理 | 可见（目录网格） | extract | split-editor | /tools/extract-ip | unctional_audit_gate + 	est_tools_js PASS |
| 21 | extract-number-date | 提取数字和日期 | 文本处理 | 可见（目录网格） | extract | split-editor | /tools/extract-number-date | unctional_audit_gate + 	est_tools_js PASS |
| 22 | base64 | Base64 编码与解码 | 文本处理 | 可见（目录网格） | code | split-editor | /tools/base64 | unctional_audit_gate + 	est_tools_js PASS |
| 23 | url-code | URL 编码与解码 | 文本处理 | 可见（目录网格） | code | split-editor | /tools/url-code | unctional_audit_gate + 	est_tools_js PASS |
| 24 | html-entities | HTML 实体编码与解码 | 文本处理 | 可见（目录网格） | code | split-editor | /tools/html-entities | unctional_audit_gate + 	est_tools_js PASS |
| 25 | unicode-code | Unicode 转换 | 文本处理 | 可见（目录网格） | code | split-editor | /tools/unicode-code | unctional_audit_gate + 	est_tools_js PASS |
| 26 | json-format | JSON 格式化 | 文本处理 | 可见（目录网格） | json | split-editor | /tools/json-format | unctional_audit_gate + 	est_tools_js PASS |
| 27 | json-minify | JSON 压缩 | 文本处理 | 可见（目录网格） | json | split-editor | /tools/json-minify | unctional_audit_gate + 	est_tools_js PASS |
| 28 | json-validate | JSON 合法性检查 | 文本处理 | 可见（目录网格） | json | split-editor | /tools/json-validate | unctional_audit_gate + 	est_tools_js PASS |
| 29 | chinese-convert | 简繁体转换 | 文本处理 | 可见（目录网格） | lang | split-editor | /tools/chinese-convert | unctional_audit_gate + 	est_tools_js PASS |
| 30 | file-md5 | MD5 计算 | 文件处理 | 可见（目录网格） | hash | file-pipeline | /tools/file-md5 | unctional_audit_gate + 	est_tools_js PASS |
| 31 | file-sha1 | SHA-1 计算 | 文件处理 | 可见（目录网格） | hash | file-pipeline | /tools/file-sha1 | unctional_audit_gate + 	est_tools_js PASS |
| 32 | file-sha256 | SHA-256 计算 | 文件处理 | 可见（目录网格） | hash | file-pipeline | /tools/file-sha256 | unctional_audit_gate + 	est_tools_js PASS |
| 33 | file-sha512 | SHA-512 计算 | 文件处理 | 可见（目录网格） | hash | file-pipeline | /tools/file-sha512 | unctional_audit_gate + 	est_tools_js PASS |
| 34 | file-info | 文件基本信息 | 文件处理 | 可见（目录网格） | file | file-pipeline | /tools/file-info | unctional_audit_gate + 	est_tools_js PASS |
| 35 | csv-json | CSV 转 JSON | 文件处理 | 可见（目录网格） | table | file-pipeline | /tools/csv-json | unctional_audit_gate + 	est_tools_js PASS |
| 36 | json-csv | JSON 转 CSV | 文件处理 | 可见（目录网格） | json | file-pipeline | /tools/json-csv | unctional_audit_gate + 	est_tools_js PASS |
| 37 | text-encoding | 文本编码转换 | 文件处理 | 可见（目录网格） | file | file-pipeline | /tools/text-encoding | unctional_audit_gate + 	est_tools_js PASS |
| 38 | text-split | 文本文件分割 | 文件处理 | 可见（目录网格） | split | file-pipeline | /tools/text-split | unctional_audit_gate + 	est_tools_js PASS |
| 39 | csv-split | CSV 文件分割 | 文件处理 | 可见（目录网格） | split | file-pipeline | /tools/csv-split | unctional_audit_gate + 	est_tools_js PASS |
| 40 | txt-merge | TXT 文件合并 | 文件处理 | 可见（目录网格） | merge | file-pipeline | /tools/txt-merge | unctional_audit_gate + 	est_tools_js PASS |
| 41 | csv-merge | CSV 文件合并 | 文件处理 | 可见（目录网格） | table | file-pipeline | /tools/csv-merge | unctional_audit_gate + 	est_tools_js PASS |
| 42 | json-array-merge | JSON 数组合并 | 文件处理 | 可见（目录网格） | json | file-pipeline | /tools/json-array-merge | unctional_audit_gate + 	est_tools_js PASS |
| 43 | images-pdf | 多张图片转 PDF | 文件处理 | 可见（目录网格） | pdf | file-pipeline | /tools/images-pdf | unctional_audit_gate + 	est_tools_js PASS |
| 44 | rename-preview | 批量重命名预览 | 文件处理 | 可见（目录网格） | file | file-pipeline | /tools/rename-preview | unctional_audit_gate + 	est_tools_js PASS |
| 45 | files-zip | 文件打包为 ZIP | 文件处理 | 可见（目录网格） | zip | file-pipeline | /tools/files-zip | unctional_audit_gate + 	est_tools_js PASS |
| 46 | batch-zip | 批量 ZIP 下载 | 文件处理 | 可见（目录网格） | zip | file-pipeline | /tools/batch-zip | unctional_audit_gate + 	est_tools_js PASS |
| 47 | image-compress | 图片压缩 | 图片设计 | 可见（目录网格） | image | studio-preview | /tools/image-compress | unctional_audit_gate + 	est_tools_js PASS |
| 48 | image-batch-compress | 批量图片压缩 | 图片设计 | 可见（目录网格） | image | studio-preview | /tools/image-batch-compress | unctional_audit_gate + 	est_tools_js PASS |
| 49 | image-format | PNG、JPG、WebP 转换 | 图片设计 | 可见（目录网格） | image | studio-preview | /tools/image-format | unctional_audit_gate + 	est_tools_js PASS |
| 50 | image-resize | 图片尺寸调整 | 图片设计 | 可见（目录网格） | resize | studio-preview | /tools/image-resize | unctional_audit_gate + 	est_tools_js PASS |
| 51 | image-scale | 按百分比缩放 | 图片设计 | 可见（目录网格） | resize | studio-preview | /tools/image-scale | unctional_audit_gate + 	est_tools_js PASS |
| 52 | image-crop | 图片裁剪 | 图片设计 | 可见（目录网格） | crop | studio-preview | /tools/image-crop | unctional_audit_gate + 	est_tools_js PASS |
| 53 | crop-square | 1:1 裁剪 | 图片设计 | 可见（目录网格） | crop | studio-preview | /tools/crop-square | unctional_audit_gate + 	est_tools_js PASS |
| 54 | crop-four-three | 4:3 裁剪 | 图片设计 | 可见（目录网格） | crop | studio-preview | /tools/crop-four-three | unctional_audit_gate + 	est_tools_js PASS |
| 55 | crop-sixteen-nine | 16:9 裁剪 | 图片设计 | 可见（目录网格） | crop | studio-preview | /tools/crop-sixteen-nine | unctional_audit_gate + 	est_tools_js PASS |
| 56 | image-rotate | 图片旋转 | 图片设计 | 可见（目录网格） | rotate | studio-preview | /tools/image-rotate | unctional_audit_gate + 	est_tools_js PASS |
| 57 | image-flip | 图片翻转 | 图片设计 | 可见（目录网格） | flip | studio-preview | /tools/image-flip | unctional_audit_gate + 	est_tools_js PASS |
| 58 | image-rounded | 图片圆角 | 图片设计 | 可见（目录网格） | image | studio-preview | /tools/image-rounded | unctional_audit_gate + 	est_tools_js PASS |
| 59 | image-avatar | 圆形头像 | 图片设计 | 可见（目录网格） | image | studio-preview | /tools/image-avatar | unctional_audit_gate + 	est_tools_js PASS |
| 60 | text-watermark | 文本水印 | 图片设计 | 可见（目录网格） | watermark | studio-preview | /tools/text-watermark | unctional_audit_gate + 	est_tools_js PASS |
| 61 | image-watermark | 图片水印 | 图片设计 | 可见（目录网格） | watermark | studio-preview | /tools/image-watermark | unctional_audit_gate + 	est_tools_js PASS |
| 62 | tile-watermark | 平铺水印 | 图片设计 | 可见（目录网格） | watermark | studio-preview | /tools/tile-watermark | unctional_audit_gate + 	est_tools_js PASS |
| 63 | image-mosaic | 马赛克 | 图片设计 | 可见（目录网格） | shield | studio-preview | /tools/image-mosaic | unctional_audit_gate + 	est_tools_js PASS |
| 64 | image-blur | 高斯模糊 | 图片设计 | 可见（目录网格） | shield | studio-preview | /tools/image-blur | unctional_audit_gate + 	est_tools_js PASS |
| 65 | image-redact | 黑色遮挡 | 图片设计 | 可见（目录网格） | shield | studio-preview | /tools/image-redact | unctional_audit_gate + 	est_tools_js PASS |
| 66 | image-pdf | 图片转 PDF | 图片设计 | 可见（目录网格） | pdf | studio-preview | /tools/image-pdf | unctional_audit_gate + 	est_tools_js PASS |
| 67 | exif-view | EXIF 信息查看 | 图片设计 | 可见（目录网格） | image | studio-preview | /tools/exif-view | unctional_audit_gate + 	est_tools_js PASS |
| 68 | exif-remove | EXIF 信息删除 | 图片设计 | 可见（目录网格） | shield | studio-preview | /tools/exif-remove | unctional_audit_gate + 	est_tools_js PASS |
| 69 | gps-warning | GPS 隐私提醒 | 图片设计 | 可见（目录网格） | shield | studio-preview | /tools/gps-warning | unctional_audit_gate + 	est_tools_js PASS |
| 70 | color-extract | 图片颜色提取 | 图片设计 | 可见（目录网格） | palette | studio-preview | /tools/color-extract | unctional_audit_gate + 	est_tools_js PASS |
| 71 | color-convert | HEX、RGB 和 HSL 取色 | 图片设计 | 可见（目录网格） | palette | studio-preview | /tools/color-convert | unctional_audit_gate + 	est_tools_js PASS |
| 72 | gradient-generator | 渐变背景生成器 | 图片设计 | 可见（目录网格） | palette | studio-preview | /tools/gradient-generator | unctional_audit_gate + 	est_tools_js PASS |
| 73 | gradient-css | CSS 渐变代码生成 | 图片设计 | 可见（目录网格） | palette | studio-preview | /tools/gradient-css | unctional_audit_gate + 	est_tools_js PASS |
| 74 | solid-image | 纯色图片生成器 | 图片设计 | 可见（目录网格） | palette | studio-preview | /tools/solid-image | unctional_audit_gate + 	est_tools_js PASS |
| 75 | favicon-generator | Favicon 生成器 | 图片设计 | 可见（目录网格） | resize | studio-preview | /tools/favicon-generator | unctional_audit_gate + 	est_tools_js PASS |
| 76 | multi-icon-zip | 多尺寸图标 ZIP 下载 | 图片设计 | 可见（目录网格） | zip | studio-preview | /tools/multi-icon-zip | unctional_audit_gate + 	est_tools_js PASS |
| 77 | random-integer | 随机数字 | 随机生成 | 可见（目录网格） | random | compact-generator | /tools/random-integer | unctional_audit_gate + 	est_tools_js PASS |
| 78 | random-decimal | 随机小数 | 随机生成 | 可见（目录网格） | random | compact-generator | /tools/random-decimal | unctional_audit_gate + 	est_tools_js PASS |
| 79 | random-string | 随机字符串 | 随机生成 | 可见（目录网格） | key | compact-generator | /tools/random-string | unctional_audit_gate + 	est_tools_js PASS |
| 80 | random-password | 安全密码生成器 | 随机生成 | 可见（目录网格） | key | compact-generator | /tools/random-password | unctional_audit_gate + 	est_tools_js PASS |
| 81 | random-uuid | UUID v4 生成器 | 随机生成 | 可见（目录网格） | key | compact-generator | /tools/random-uuid | unctional_audit_gate + 	est_tools_js PASS |
| 82 | random-draw | 随机抽签 | 随机生成 | 可见（目录网格） | users | compact-generator | /tools/random-draw | unctional_audit_gate + 	est_tools_js PASS |
| 83 | random-groups | 随机分组 | 随机生成 | 可见（目录网格） | users | compact-generator | /tools/random-groups | unctional_audit_gate + 	est_tools_js PASS |
| 84 | random-wheel | 随机转盘 | 随机生成 | 可见（目录网格） | users | compact-generator | /tools/random-wheel | unctional_audit_gate + 	est_tools_js PASS |
| 85 | weighted-wheel | 带权重转盘 | 随机生成 | 可见（目录网格） | users | compact-generator | /tools/weighted-wheel | unctional_audit_gate + 	est_tools_js PASS |
| 86 | random-date | 随机日期 | 随机生成 | 可见（目录网格） | calendar | compact-generator | /tools/random-date | unctional_audit_gate + 	est_tools_js PASS |
| 87 | random-time | 随机时间 | 随机生成 | 可见（目录网格） | calendar | compact-generator | /tools/random-time | unctional_audit_gate + 	est_tools_js PASS |
| 88 | random-color | 随机颜色 | 随机生成 | 可见（目录网格） | palette | compact-generator | /tools/random-color | unctional_audit_gate + 	est_tools_js PASS |
| 89 | random-palette | 随机调色板 | 随机生成 | 可见（目录网格） | palette | compact-generator | /tools/random-palette | unctional_audit_gate + 	est_tools_js PASS |
| 90 | coin-flip | 抛硬币 | 随机生成 | 可见（目录网格） | dice | compact-generator | /tools/coin-flip | unctional_audit_gate + 	est_tools_js PASS |
| 91 | dice-d4 | D4 骰子 | 随机生成 | 可见（目录网格） | dice | compact-generator | /tools/dice-d4 | unctional_audit_gate + 	est_tools_js PASS |
| 92 | dice-d6 | D6 骰子 | 随机生成 | 可见（目录网格） | dice | compact-generator | /tools/dice-d6 | unctional_audit_gate + 	est_tools_js PASS |
| 93 | dice-d8 | D8 骰子 | 随机生成 | 可见（目录网格） | dice | compact-generator | /tools/dice-d8 | unctional_audit_gate + 	est_tools_js PASS |
| 94 | dice-d10 | D10 骰子 | 随机生成 | 可见（目录网格） | dice | compact-generator | /tools/dice-d10 | unctional_audit_gate + 	est_tools_js PASS |
| 95 | dice-d12 | D12 骰子 | 随机生成 | 可见（目录网格） | dice | compact-generator | /tools/dice-d12 | unctional_audit_gate + 	est_tools_js PASS |
| 96 | dice-d20 | D20 骰子 | 随机生成 | 可见（目录网格） | dice | compact-generator | /tools/dice-d20 | unctional_audit_gate + 	est_tools_js PASS |
| 97 | custom-dice | 自定义骰子 | 随机生成 | 可见（目录网格） | dice | compact-generator | /tools/custom-dice | unctional_audit_gate + 	est_tools_js PASS |
| 98 | random-decision | 随机决定器 | 随机生成 | 可见（目录网格） | users | compact-generator | /tools/random-decision | unctional_audit_gate + 	est_tools_js PASS |
| 99 | file-transfer | 文件传输 | 临时工具 | 可见（目录网格） | transfer | temporary-utility | /tools/file-transfer | unctional_audit_gate + 	est_tools_js PASS |
| 100 | temporary-text | 临时文本分享 | 临时工具 | 可见（目录网格） | link | temporary-utility | /tools/temporary-text | unctional_audit_gate + 	est_tools_js PASS |
| 101 | temporary-file | 临时文件分享 | 临时工具 | 退役别名（重定向 /transfer） | transfer | temporary-utility | /tools/temporary-file | unctional_audit_gate + 	est_tools_js PASS |
| 102 | temporary-clipboard | 临时剪贴板 | 临时工具 | 可见（目录网格） | clipboard | temporary-utility | /tools/temporary-clipboard | unctional_audit_gate + 	est_tools_js PASS |
| 103 | temporary-qr | 临时二维码 | 临时工具 | 可见（目录网格） | qr | temporary-qr | /tools/temporary-qr | unctional_audit_gate + 	est_tools_js PASS |
| 104 | temporary-room | 临时留言房间 | 临时工具 | 可见（目录网格） | chat | temporary-utility | /tools/temporary-room | unctional_audit_gate + 	est_tools_js PASS |
