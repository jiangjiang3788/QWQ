# App Workspace Architecture

## 用户层级

```text
App 启动器
→ 独立 App
→ 一个主任务页面
→ 必要时打开弹窗或详情页
```

主流程不再经过“更多”聚合页。

## App 启动器

`js/app_registry.js` 是 App 元数据与打开方式的唯一注册表。

首页分区仅决定展示顺序，不改变 App 的数据和运行模块。

## 设置 App

`settings_hub.js` 是设置入口目录，不保存具体设置。

具体设置仍由现有页面负责：

- API：`api-settings-screen`
- 外观：`appearance-settings-screen`
- 数据：`storage-analysis-screen`
- 角色：`chat-settings-screen`

## API 工作区

`api_workspace.js` 通过现有标题识别副 API 区块，并为其添加 `data-api-group`。

它只控制显示，不修改：

- DOM ID
- 表单事件
- 数据库字段
- API 请求实现

## 兼容策略

`more-screen` 保留在 DOM 中，但路由会转入 `settings-hub-screen`。旧模块可以在后续版本逐步更换返回目标。
