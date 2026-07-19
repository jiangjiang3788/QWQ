# 记忆内核边界（V2.9-R1）

## 对外入口

业务代码优先使用 `window.OvoMemory`：

- `OvoMemory.state`：状态初始化与当前角色
- `OvoMemory.screen`：记忆 App 页面
- `OvoMemory.context`：聊天 Prompt 记忆上下文
- `OvoMemory.templates`：绑定模板
- `OvoMemory.conversion`：旧文本记忆转换
- `OvoMemory.autoUpdate`：后台整理入口
- `OvoMemory.module(name)`：高级模块访问
- `OvoMemory.health()`：模块健康检查

旧的 `prepareMemoryTableContext`、`renderMemoryTableScreen` 等函数由 facade 兼容桥提供，不再由主控制器直接散落导出。

## 内核模块

```text
kernel
├─ core：clone、escape、clamp、unique、ID、hash、数组移动
├─ registry：模块注册、依赖查找、健康检查
├─ domain：模板、字段、行、锁定、历史、基础状态
├─ api：主 API / 总结 API 路由和请求适配
└─ controller：现有 UI 与工作流控制器
```

已有策略模块统一注册：

```text
policy lifecycle effects feedback review retrieval sidecar tasks quality
```

## 依赖规则

```text
UI / Chat
   ↓
OvoMemory facade
   ↓
controller / services
   ↓
domain / policy modules
   ↓
API 与数据库适配
```

新增代码不得直接新增 `window.MemoryTable*` 全局对象。兼容全局只由 kernel 注册和 facade 桥维护。

## 本阶段保留项

`memory_table.js` 仍包含页面渲染、事件绑定、审核应用、转换和导入导出。它将在后续包继续拆为：

```text
ui/tables
ui/inbox
ui/manage
services/update
services/review
services/import-export
```

本阶段不修改记忆 schema，也不修改 209 条原始记录。
