全量 JavaScript 语法：
  find js -name '*.js' -print0 | xargs -0 -n1 node --check

静态资源、DOM、记忆结构：
  python tests/run_static_checks.py

记忆 V2.1～V2.8：
  node tests/run_v21_review_checks.js
  node tests/run_v22_retrieval_checks.js
  node tests/run_v23_sidecar_checks.js
  node tests/run_v24_effects_checks.js
  node tests/run_v25_lifecycle_checks.js
  node tests/run_v26_task_checks.js
  node tests/run_v27_feedback_checks.js
  node tests/run_v28_quality_checks.js

重构版本回归：
  node tests/run_v29_r0_app_registry_checks.js
  node tests/run_v29_r1_memory_kernel_checks.js
  node tests/run_v29_r2_memory_workspace_checks.js
  node tests/run_v29_r3_app_workspace_checks.js
  node tests/run_v29_r4_settings_components_checks.js
  node tests/run_v29_r5_character_settings_checks.js
  node tests/run_v29_r6_navigation_workspace_checks.js

重构基线与模板哈希：
  python tools/check_refactor_baseline.py

说明：真实 API、IndexedDB、Android/iOS WebView、触摸、软键盘和系统返回键仍需在实际部署环境回归。
