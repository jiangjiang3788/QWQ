# App Workspace Architecture

## 用户层级

```text
手机桌面
→ 一级 App
→ 一个主任务工作区
→ 必要时打开详情或弹窗
```

主流程不经过旧“更多”聚合页，也不在多个位置重复同一功能。

## App 启动器

`js/app_registry.js` 是 App 元数据、所属入口和打开方式的唯一注册表。

```text
dock：聊天、角色、记忆、设置
main：世界书、剧场、收藏、提醒、搜索
settings：API、数据、外观
context：联系人
advanced：高级工具
```

## 设置 App

`settings_hub.js` 只做配置目录，不保存具体设置，也不重复角色列表和记忆工作区。

具体页面仍负责自己的表单和数据：

- API：`api-settings-screen`
- 外观：`appearance-settings-screen`
- 数据：`storage-analysis-screen`
- 角色：`chat-settings-screen`

## 角色 App

角色列表是角色操作的统一入口。每个角色只有三项主动作：聊天、记忆、设置。

## 记忆 App

记忆工作台只有三层一级工作区：记忆、待处理、管理。内部详情通过工作区状态切换，不创建新的重复 App。

## 导航兼容

旧 `more-screen` 路由会转入 `settings-hub-screen`。所有标准返回按钮通过 `OvoNavigation.back()` 返回真实来源；按钮 `data-target` 只作为没有历史时的兜底。
