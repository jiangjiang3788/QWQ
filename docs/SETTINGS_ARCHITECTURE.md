# 设置子系统架构（V2.9-R5）

## 稳定公共入口

```js
OvoSettings.health();
OvoCharacterSettings.health();
```

旧初始化函数继续兼容。

## 文件职责

| 文件 | 职责 |
|---|---|
| `js/settings.js` | 角色设置兼容入口与少量跨域辅助函数 |
| `features/settings/character/context.js` | 五个角色设置控制器的注册与阶段编排 |
| `features/settings/character/*_controller.js` | 资料、聊天、行为、媒体、扩展五个领域 |
| `features/settings/magic_room.js` | 魔法房间、后台行为和系统通知 |
| `features/settings/api_controller.js` | 主 API、子 API、生图和模型配置 |
| `features/settings/presets.js` | API 以外的预设、壁纸、音色、图标和名称 |
| `features/settings/customization.js` | 桌面自定义、全局 CSS、字体和状态栏 |
| `features/settings/preset_manager.js` | 统一预设管理流程 |
| `features/settings/facade.js` | 设置子系统健康检查和公共入口 |
| `core/ui_components.js` | 通用按钮、空状态、遮罩层和操作列表 |

## 依赖原则

```text
设置页面
→ 领域控制器
→ db / saveData / 既有业务服务
```

- 控制器负责 DOM 与角色字段映射。
- 公共 UI 组件不直接修改数据库。
- `settings.js` 不再承载新的角色设置业务。
- 数据字段与 HTML ID 的迁移应独立成版本，不与控制器拆分同时进行。
