# V2.9-R0 代码基线清单

本文件用于后续重构前后对比，不代表目标结构。

## 规模

- JavaScript：56 个文件，58,273 行，2.71 MB
- CSS：32 个文件，16,299 行，397 KB
- index.html：6,939 行，355 KB

## 最大 JavaScript 文件

| 文件 | 行数 | 大小 |
|---|---:|---:|
| `js/settings.js` | 7,867 | 376 KB |
| `js/modules/memory_table.js` | 5,276 | 293 KB |
| `js/modules/chat_ai.js` | 3,988 | 221 KB |
| `js/modules/theater.js` | 3,124 | 133 KB |
| `js/modules/tutorial.js` | 2,735 | 141 KB |
| `js/modules/chat_render.js` | 2,351 | 124 KB |
| `js/utils.js` | 2,005 | 82 KB |
| `js/modules/journal.js` | 1,952 | 82 KB |
| `js/modules/music_player.js` | 1,752 | 81 KB |
| `js/modules/chat_ops.js` | 1,645 | 69 KB |
| `js/modules/vector_memory.js` | 1,565 | 72 KB |
| `js/modules/sticker.js` | 1,521 | 62 KB |
| `js/modules/avatar_recognition.js` | 1,448 | 75 KB |
| `js/db.js` | 1,306 | 68 KB |
| `js/modules/worldbook.js` | 1,093 | 51 KB |

## R0 新边界

- `js/app_registry.js` 是首页 App 的单一注册表。
- `js/core/feature_flags.js` 是功能开关入口。
- 结构化记忆数据格式冻结在 V2.8。
- R1 前不删除旧全局兼容接口。
- 生产根目录不再放历史版本说明和旧模板。


## V2.9-R1 记忆内核变化

- 新增统一 kernel、domain、API adapter 和 facade。
- `memory_table.js` 从 5276 行降至约 4519 行。
- 记忆模块公共 clone/escape/clamp/unique/id/hash/move helper 已收敛。
- 新代码应通过 `OvoMemory` 或 `OvoMemoryKernel.get(name)` 访问，不再新增全局函数。

## V2.9-R4 设置代码变化

- `js/settings.js` 从 7,867 行降至约 2,764 行。
- 设置控制器拆为 `magic_room.js`、`api_controller.js`、`presets.js`、`customization.js`。
- 十套预设管理弹窗统一由 `settings/preset_manager.js` 和 `OvoUI.renderActionList()` 生成。
- 设置相关直接 `.style.* =` 赋值由 363 处降至约 223 处。
- 新增 `OvoSettings.health()`，用于确认各设置控制器和公共 UI 组件是否就绪。

## V2.9-R6 导航与工作台变化

- `js/ui.js`：增加统一导航栈与 `OvoNavigation` facade。
- `js/main.js`：所有 `.back-btn` 统一走导航栈。
- `js/app_registry.js`：Dock、桌面、设置和上下文入口重新分组；角色 App 统一三动作。
- `js/modules/memory_table.js`：修复工作区状态在渲染时被旧 runtime 覆盖的问题。
- `js/core/diagnostics.js`：增加脱敏运行快照、错误环形缓冲和诊断弹窗。
- `css/modules/app_workspace.css`：首页切换为横向原生分页，禁止长纵向桌面列表。
- `tests/run_v29_r6_navigation_workspace_checks.js`：覆盖工作区状态、返回栈、入口去重和诊断加载。
