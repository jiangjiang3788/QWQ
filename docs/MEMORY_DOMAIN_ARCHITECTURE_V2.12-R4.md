# V2.12-R4 记忆领域架构

## 目标

V2.12-R4 不增加新的用户功能。它把 V2.11-R0 至 V2.12-R3 已完成的表格、治理、引用审计、模型整理和结构编辑能力，正式收敛为稳定的领域边界，避免 `memory_table.js` 再次直接依赖所有叶子模块。

## 控制器依赖规则

`js/modules/memory_table.js` 只能依赖以下公开门面：

| 门面 | 职责 |
|---|---|
| `memoryPlatformDomain` | 策略、审核、生命周期、任务、反馈、质量、调度等平台服务 |
| `memoryFoundationDomain` | 领域数据、API 适配和工作区状态 |
| `memoryTablesDomain` | 表格呈现、虚拟化、编辑、缓存、保存和局部刷新 |
| `memoryGovernanceDomain` | 标签词表、关系、合并审核、候选、统一待处理和侧栏 |
| `memoryRetrievalDomain` | 记忆引用与作用审计 |
| `memorySchemaDomain` | 表结构模型与统一结构编辑器 |
| `memoryUpdateDomain` | 标签生成、跨表上下文和模型整理 |

控制器不得直接 `Kernel.require('tableGrid')`、`Kernel.require('schemaEditor')`、`Kernel.require('relationService')` 等叶子模块。

## 目录与契约

- `architecture/memory_domains.json`：领域、模块归属、允许的控制器依赖和代码体积预算。
- `architecture/ui_budgets.json`：表格、侧栏、引用审计、悬浮球和结构编辑器的 UI 预算。
- `js/features/memory/domains/*.js`：7 个公开领域门面。
- `js/features/memory/architecture.js`：运行时领域健康检查。
- `js/features/memory/maintenance.js`：运行时 UI 预算测量。
- `tools/check_memory_architecture.py`：静态架构门禁。

## 门禁

当前自动门禁包括：

1. 每个叶子模块只能归属一个领域。
2. 领域门面必须实际加载并暴露其声明的模块。
3. 门面必须在叶子模块之后、主控制器之前加载。
4. 主控制器只能依赖声明的领域门面和架构健康服务。
5. 关键文件不能超过行数预算。
6. 已退役的悬浮球二级入口和拆分模板编辑器不能重新出现。
7. 虚拟表可见行、活动编辑器、共享菜单、常驻编辑按钮和页面溢出受运行时预算约束。

## 当前预算

| 文件 | 上限 |
|---|---:|
| `js/modules/memory_table.js` | 4000 行 |
| `js/modules/floating_ball.js` | 1020 行 |
| `js/features/memory/schema_editor.js` | 900 行 |
| `js/features/memory/retrieval_audit.js` | 700 行 |
| `js/settings.js` | 500 行 |

后续新增能力应进入对应领域。需要跨领域调用时，应先扩展领域门面，而不是让页面控制器重新抓取叶子模块。
