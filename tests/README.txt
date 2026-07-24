静态检查：
  python tests/run_static_checks.py

V2.1 审核队列专项检查：
  node tests/run_v21_review_checks.js

V2.2 检索、关键词回退与合并目标专项检查：
  node tests/run_v22_retrieval_checks.js

JavaScript 全量语法检查：
  find js -name '*.js' -print0 | xargs -0 -n1 node --check

说明：真实 API、IndexedDB、桌面与手机浏览器交互仍需在实际部署环境回归。

V2.3:
  node tests/run_v23_sidecar_checks.js
验证可见文本剥离、状态更新、待办新增/完成、候选保存和短期表策略迁移。

V2.4:
  node tests/run_v24_effects_checks.js
验证四维标签、场景识别、暂停/候选/冷却硬过滤、Prompt 使用约束和 209 行元数据迁移。

V2.5 来源/冲突/遗忘专项：node tests/run_v25_lifecycle_checks.js

V2.6:
  node run_v26_task_checks.js
  Covers persistent queue normalization, range idempotency, retry, review linkage, interrupted-task recovery, per-round API limit, pause/resume.
- run_v28_quality_checks.js: fixed test set, dry-run safety, duplicate scan, baseline regression, auto local task, V2.8 package/data preservation.

run_v29_r1_memory_kernel_checks.js
- 验证统一 kernel、domain、API adapter、OvoMemory facade、兼容桥与公共 helper 去重。

V2.9-R6 体验入口与记忆调度：
  node tests/run_v29_r6_experience_memory_checks.js
验证 Dock 唯一配置源、收藏语音转写、更新面板位置、表级自动化通道和全局调度生效。

V2.9-R7 启动可靠性：
node tests/run_v29_r7_startup_checks.js


V2.9-R8 启动契约：
- node tests/run_v29_r8_startup_contract_checks.js
- 覆盖顶层 const/let 不挂到 window、显式任务注册、核心任务预检。

V2.9-R10 记忆入口与搜索导航：
  node tests/run_v29_r10_memory_search_checks.js

V2.9-R11 记忆工作区状态机：
  node tests/run_v29_r11_memory_workspace_state_checks.js
验证角色运行态水合、显式工作区切换、待处理/管理/反馈路由不会互相覆盖。

V2.10-R0 AI 操作中心：
  node tests/run_v210_r0_operation_center_checks.js
验证统一操作运行时、请求关联、悬浮球详情、取消与脱敏。

V2.10-R1 Prompt 来源视图：
  node tests/run_v210_r1_prompt_source_checks.js
验证最终请求拆分、显式来源合并、结构化档案 Prompt 解析、深层来源条目保留，以及私聊/小剧场/Proment 接入。

V2.10-R2 后台操作回执：
  node tests/run_v210_r2_background_operation_checks.js
验证主操作与后台子操作关联、成功/跳过/失败聚合，以及自动日记、结构化档案、向量记忆、角色小剧场与悬浮球接入。


V2.10-R2.1 紧急修复：
- run_v210_r21_hotfix_checks.js：反馈展示、扁平操作详情、消息时间、结构化记忆审核交互与单次聊天请求检查。

V2.10-R3 数据变化回执：
  node tests/run_v210_r3_mutation_receipt_checks.js
验证轻量 Mutation Receipt、父子操作变化汇总、聊天消息/角色档案/结构化记忆/日记/向量记忆/小剧场写入接入，以及悬浮球扁平变化视图。

V2.10-R3.1 快速修复：
- node tests/run_v210_r31_quick_hotfix_checks.js
- 检查时间元数据防回显、聊天即时渲染对账、自定义 Prompt 记忆兜底注入及档案记忆来源展示。


V2.10-R3.2 档案记忆注入修复：
- node tests/run_v210_r32_archive_injection_checks.js
- 验证结构化档案在 vector/journal 模式下仍作为基础上下文注入，并与补充记忆分层展示。

V2.10-R3.3 任务稳定与记忆核验：
- run_v210_r33_stability_memory_checks.js：页面切换任务隔离、全局记忆队列恢复、悬浮球全屏、反馈过期治理、OpenAI/Gemini 最终请求记忆核验。

V2.11-R4 统一待处理与长期记忆治理：
  node tests/run_v211_r4_memory_governance_checks.js
验证统一待处理队列、批量确认/延后/归档、长期候选晋升、生命周期/标签筛选，以及表格渲染与候选服务从主控制器拆出。

V2.11-R5 大表虚拟化与按需行操作：
  node tests/run_v211_r5_memory_virtualization_checks.js
验证 80 行启用虚拟窗口、可见范围与上下占位高度、滚动中的活动编辑行、共享行操作菜单、旧 select/option 路径删除，以及主控制器继续收敛。

V2.11-R6 增量表格与状态收敛：
- node tests/run_v211_r6_incremental_table_checks.js
- 验证表格会话状态、模型组装、局部刷新、字段保存不整页重渲染，以及主控制器体积门禁。

V2.11-R7 表格缓存、合并持久化与撤销：
- node tests/run_v211_r7_table_cache_persistence_checks.js
- 验证派生模型 LRU 缓存、表级失效、同角色快速保存合并、字段撤销、编辑控制器拆分和主控制器体积门禁。

V2.12-R0 记忆表格交互统一：
- node tests/run_v212_r0_memory_interaction_unification_checks.js
- 检查字段一级分组、标签正式列、双击/双点编辑、无常驻编辑按钮与行菜单收敛。

V2.12-R1 记忆引用与作用：
- node tests/run_v212_r1_memory_retrieval_audit_checks.js
- 检查召回与反馈统一入口、按表总览/引用明细、标准化引用原因、本轮作用、直接反馈和移动端表格收敛。

V2.12-R2 悬浮球主操作收敛：
- run_v212_r2_quick_dock_flat_actions_checks.js

V2.12-R3 表结构编辑器统一：
- node tests/run_v212_r3_memory_schema_editor_checks.js
- 检查模板/字段/结构 JSON 单一入口、表格式字段与 JSON 路径编辑、同一 schema 草稿同步、旧双编辑器退役和控制器收敛。

V2.12-R4 领域边界与维护门禁：
- node tests/run_v212_r4_architecture_maintenance_checks.js
- python3 tools/check_memory_architecture.py
- 检查 7 个记忆领域门面、43 个叶子模块归属、控制器禁止绕过门面、脚本加载顺序、关键文件行数预算与运行时 UI 预算。

V2.12-R5.1 单元格更新高亮：
- 最新更新批次按模板、表格、行和字段定位具体单元格。
- 键值字段、行字段和标签单元格均可高亮。
- 重复字段变化只计为一个高亮单元格。

V2.12-R5.2 字段名称列自适应：
- node tests/run_v212_r52_adaptive_schema_field_width_checks.js
- 按当前表最长字段名称估算显示宽度；桌面 68–112px，手机 54–74px。
- 修改字段名称时实时重算；超长名称通过输入框 title 与省略显示保留完整内容。

V2.12-R5.3
- 检查 KV 字段名列按最长显示名称动态计算；桌面/手机使用紧凑上限。
- 检查所有记忆表使用双击或手机双点进入编辑，不再以单击选中和 Enter 作为主交互。
- 检查 Git 快速恢复使用 raw 下载、候选逐个校验，并跳过 404/旧格式/损坏备份。

V2.13-R0 API 与向量架构：
- node tests/run_v213_r0_api_vector_architecture_checks.js
- node tests/run_v213_r0_vector_transport_runtime_checks.js
- 检查 API 单一注册表、向量禁止错误回退、端点规范化、真实 Embedding 验证、统一批处理传输、重复 API 子导航退役和 KV 最长字段名统一列宽。

V2.13-R4 Sidecar 候选闭环：
- node tests/run_v213_r4_sidecar_candidate_closure_checks.js
- 验证旧 processed 迁移、保存/合并/忽略/删除、目标追踪、幂等与持久化失败回滚。

V2.13-R5 长期候选原子晋升与交互改进：
- node tests/run_v213_r5_atomic_promotion_and_interaction_checks.js
- 验证显式长期目标、批准原子回滚、重复批准幂等、整行弹窗编辑与撤销，以及 Netlify 文件清理。

V2.13-R5.1 全屏 KV 编辑与更新记录计数：
- node tests/run_v213_r51_fullscreen_kv_and_record_count_checks.js
- 验证整行编辑覆盖整个屏幕、字段/值双列 KV 布局、长文本自动展开，以及同一行多个字段只计为一条更新记录。


V2.13-R5.2 统一表结构工作台与中文作用：
- node tests/run_v213_r52_three_enter_reply_checks.js
- node tests/run_v213_r52_unified_schema_and_chinese_effect_checks.js
- 验证连续 3 次独立 Enter 触发 AI 回复且保持 30 秒冷却。
- 验证“作用”下拉项全部中文显示，内部英文键保持兼容。
- 验证字段、表格和高级设置收敛为一个全屏工作台；原始 JSON 仅保留折叠出口。
- 验证选项、最小值和最大值允许留空，表格和字段高级设置均作为表格列编辑。

V2.13-R5.3 记忆策略与表格设置收敛：
- node tests/run_v213_r53_memory_strategy_convergence_checks.js
- 验证模板表格使用连续无卡片布局并隐藏内部 ID。
- 验证表格职责、信息来源、写入方式、API、周期、召回与运行状态统一为同一张表的列。
- 验证全局抽屉只保留聊天采集、周期默认值和召回安全，不再重复配置逐表通道或全局审核。
- 验证旧模板策略推导、每表写入审核、稳定职责路由与重复职责冲突门禁。
- 本版不包含更新审核事务重写；该部分留给 V2.13-R5.4。

V2.13-R5.4 更新审核事务闭环：
- node tests/run_v213_r54_review_transaction_closure_checks.js
- 验证一批只对应一张表、每表写入方式决定审核、同一行字段按一条记忆分组。
- 验证整条接受/拒绝与逐字段调整、记录数/字段数双计数，以及内部行 ID 不在审核界面显示。
- 验证应用、拒绝、取消与回滚使用完整 memoryTables 快照；持久化失败恢复档案、游标、任务和审核队列。
- 验证“拒绝并跳过消息范围”和“取消并保留处理范围”具有不同状态与明确文案。
- 验证连续三次回车保持 30 秒冷却，但整个手势不显示任何提示消息。

V2.14-R0 记忆完整性医生与导入安全：
- node tests/run_v214_r0_memory_integrity_and_import_safety_checks.js
- 验证完整性扫描为只读操作，并识别重复职责、长期目标断点、孤立关系、旧候选与失效游标。
- 验证可迁移记忆包为模板、表格、字段和行建立全局 ID 映射。
- 验证长期晋升目标、跨表关系、工作流、Sidecar 候选目标及质量测试引用完整重映射。
- 验证跨角色导入会清空消息、轮次、审核和运行历史，同时保持正式行数量和可验证关系。

V2.14-R1 单人版记忆写入协调：
- node tests/run_v214_r1_memory_write_coordinator_checks.js
- 验证同一角色写入串行、完整 memoryTables 快照回滚、无变化不落盘。
- 验证表格字段/整行、Sidecar 候选、聊天 Sidecar、更新审核、API 直接更新和长期晋升接入统一写入协调器。
- 本版面向单人本地使用，不引入多人版本合并、远程锁或复杂 revision 协议。
