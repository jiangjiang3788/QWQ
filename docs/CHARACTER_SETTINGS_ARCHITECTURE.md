# 角色设置控制器架构（V2.9-R5）

## 对外入口

旧代码继续调用：

```js
setupChatSettings();
loadSettingsToSidebar();
await saveSettingsFromSidebar();
```

新代码可以检查：

```js
OvoCharacterSettings.health();
OvoSettings.health();
```

## 五个领域控制器

| 控制器 | 职责 |
|---|---|
| `profile_controller.js` | 角色资料、用户资料、人设、时区和设置页面壳层 |
| `chat_controller.js` | 记忆模式、回复数量、日记、世界书、聊天显示和状态面板 |
| `behavior_controller.js` | 思维链、小剧场、自动回复、拉黑与角色掌控 |
| `media_controller.js` | 头像、背景、头像识别、气泡与生图/TTS 媒体配置 |
| `extensions_controller.js` | 导入导出、消息版本、正则、搜索、天气和新档操作 |

## 编排器

`character/context.js` 负责：

- 控制器注册；
- `setup / load / save` 三个阶段的顺序；
- 当前角色获取；
- 防止初始化重复执行；
- 控制器健康检查。

控制器可以拥有不同的阶段顺序，以保持旧版事件绑定和保存行为：

```text
setup：资料 → 媒体 → 扩展 → 行为 → 聊天
load：资料 → 聊天 → 行为 → 媒体 → 扩展
save：资料 → 聊天 → 行为 → 媒体 → 扩展
```

## 兼容边界

`js/settings.js` 只保留：

- 三个旧公共入口；
- 群聊记忆列表等跨控制器辅助函数；
- TTS 预设导入导出；
- 备份提醒和聊天状态重算。

本版不修改：

- HTML 表单 ID；
- 角色数据库字段；
- API 请求字段；
- IndexedDB 结构；
- 记忆模板和记忆 schema。

## 后续规则

新增角色设置时：

1. 先判断属于哪个领域；
2. 在对应控制器增加 `setup/load/save`；
3. 不再把逻辑写回 `settings.js`；
4. 跨领域逻辑通过小型服务或明确辅助函数协调；
5. 不直接复制整段弹窗和表单绑定代码。
