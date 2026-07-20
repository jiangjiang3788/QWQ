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

## V2.9-R5 角色设置边界

- `js/settings.js` 收敛为兼容门面。
- 角色资料、聊天、行为、媒体和扩展拆到 `js/features/settings/character/`。
- `OvoCharacterSettings.health()` 提供注册和初始化健康检查。

## V2.9-R7 体验与记忆调度边界

- `js/app_registry.js` 的 `dockAppIds` 是 Dock 顺序的唯一配置源。
- `js/modules/message_content.js` 是消息格式与列表预览的共享解析层。
- `favorites.js` 保存原始内容与规范化快照，旧收藏在读取时兼容解析。
- `memory_table_policy.js` 只负责自动化通道、有效策略、轮次和游标，不操作 DOM。
- `memory_table.js` 展示表级通道和运行状态；“更新与整理”属于记忆页。
- 本版不修改 V2.8 记忆模板行数据和 IndexedDB schema。


## V2.9-R8 启动契约边界

- `js/core/startup_runtime.js`：任务注册、解析、预检、隔离与报告。
- `js/db.js`：显式导出 `initDatabase`、`loadData` 核心启动任务。
- `js/main.js`：只负责编排，不再推断函数的全局暴露方式。


## V2.9-R9
- 统一导航栈与返回按钮契约。
- 删除角色 App、联系人 App、旧全局底栏入口；聊天仅保留桌面 Dock 入口。
- 首页改为跨桌面与手机一致的四列手机桌面网格。


## V2.9-R10

- `js/app_registry.js`：角色工作区最近选择、dialog 能力适配、记忆入口恢复。
- `js/modules/memory_table.js`：统一 `selectMemoryWorkspace()` 状态迁移。
- `js/modules/search.js`：独立启动任务和导航栈返回。
- `tests/run_v29_r10_memory_search_checks.js`：旧 WebView 角色选择与搜索导航专项回归。

## V2.9-R11

- `js/modules/memory_table.js`：拆分角色 UI 水合与工作区状态提交，统一全部工作区路由。
- `tests/run_v29_r11_memory_workspace_state_checks.js`：执行真实控制器，覆盖待处理、管理、反馈和角色切换状态回归。
