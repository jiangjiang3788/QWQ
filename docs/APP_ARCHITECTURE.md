# 多 App 信息架构

V2.9-R6 保留桌面式多 App 体验，并由 `js/app_registry.js` 统一维护应用、启动器分区和 Dock。

## 首页应用

- 角色：独立角色库，可进入聊天或角色记忆。
- 记忆：选择角色后进入结构化记忆。
- 世界书
- 剧场
- 收藏
- 提醒
- 搜索
- 联系人

## 常用 Dock

Dock 只承载四个高频入口，并由唯一的 `dockAppIds` 配置源决定：

- 聊天
- API
- 记忆
- 设置

角色仍保留在首页启动器中，不在 Dock 重复出现。数据和外观归入首页“系统”分区。

## 高级工具

高级工具继续保留在 Apps 页面：

- Proment
- 正则
- 思维链
- 状态栏

## 约束

1. App 注册信息、启动器分区和 Dock 顺序只在 `js/app_registry.js` 维护。
2. `renderLauncher()` 与 `OvoAppRegistry.list('dock')` 必须读取同一份 Dock 配置，不能各自维护数组。
3. 首页不再手写应用 HTML。
4. 功能开关统一从 `js/core/feature_flags.js` 读取。
5. 退役入口默认关闭，不删除用户数据。
6. 一个 App 对应一个清晰用户任务，不按内部技术模块拆入口。
