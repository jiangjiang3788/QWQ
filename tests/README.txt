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
