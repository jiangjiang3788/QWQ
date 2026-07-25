# V5.4.1 原地升级与范围说明

## 一、不会重置已有记忆
本版沿用 `STORE_VERSION=3`。覆盖代码后仍从原环境的本地存储读取现有9张表、字段设置和记录。不要重新导入空表，也不要更换域名、端口或应用包名。

## 二、主聊天统一编译
主私聊请求的最终流程调整为：

```text
旧业务模块提供候选内容
→ ContextCompiler应用真实开关和预算
→ 最终Memory Payload核验
→ ContextSourceRegistry生成compiled Manifest
→ AIRequestRuntime发送
```

### 已真实接管的设置
- 世界书启用与字符预算：由 `WorldBookContextProvider` 执行；
- 结构化记忆启用与字符预算：由 `ContextCompiler` 执行；
- 最近聊天启用与条数：由 `ContextCompiler` 对最终消息数组执行；
- 状态注入启用：由 `ContextCompiler` 对最终system内容执行。

## 三、最终来源登记
`buildCompiledManifest()` 会登记：
- 核心系统规则和模板残余；
- 角色、用户、世界书、结构化记忆、输出规则等子来源；
- 聊天历史；
- 本轮用户输入；
- CoT、继续对话及预填控制消息；
- 模型Tools；
- 模型、temperature、stream及Provider参数。

Manifest保存在：
- `window.__ovoLastContextManifest`；
- `sessionStorage.ovo_last_context_manifest`；
- 当前操作记录的模型请求详情中。

## 四、世界书领域内聚
世界书的候选选择、关键词命中、预算裁剪、前中后位置和诊断由：

```javascript
WorldBookContextProvider.provide(character)
```

统一提供。`chat_ai.js` 只消费结果，不再实现世界书内部算法。

## 五、记忆界面调整
核心档案和当前状态不再以类似表格的分隔行展示，而是：

```text
分类标题
  记录标题
  记录内容
  操作按钮
```

分类标题与记录标题字号一致。Rows表格只显示字段名，字段 `aiHint` 不在表头展示，但不会从数据结构中删除。

## 六、尚未迁移的范围
以下AI任务仍使用原有请求入口，计划在V5.4.2迁移：
- 图片、头像和表情包识别；
- 日记；
- 小剧场；
- 通话；
- 电量互动；
- 生图；
- 后台关系判断等。

本版没有进行Android真机和真实模型全功能测试。
