# V5.8.3 重回联动撤销记忆：系统事务改造

## 目标

聊天页点击“重回”时，不能只删除当前 AI 回复。该回复在生成过程中写入的动态记忆、当前状态和角色自主收藏，也必须作为同一轮事务一起撤销。消息版本切换时，则需要撤销当前分支的记忆并恢复目标分支对应的记忆。

本次采用内核级事务改造，不通过页面监听、延迟清理或按字段猜测删除等补丁方式实现。

## 核心设计

每次私聊请求开始时，现有 `memoryRoundId` 继续作为对话轮次标识。记忆内核新增 `memoryStore.roundTransactions`，按轮次保存记录级前后镜像：

```text
roundTransactions[]
  roundId
  status: applied | rolled_back
  createdAt / updatedAt
  mutations[]
    tableId
    recordId
    before
    after
```

同一轮对同一记录进行多次写入时，只保留最初的 `before` 和最终的 `after`。新增记录的 `before` 为 `null`；更新记录同时保存完整前后镜像。

## 重回流程

1. 从即将删除的 AI 回复读取 `memoryRoundId`。
2. 调用记忆内核的 `rollbackRounds()`。
3. 内核先校验当前记录是否仍等于该轮事务的 `after` 镜像。
4. 校验全部通过后，再原子恢复 `before` 镜像或删除本轮新增记录。
5. 记忆撤销成功后，才删除聊天回复并重新请求 AI。

如果记录在回复生成后又被用户手动编辑，或被后续流程改写，内核会报告冲突并停止“重回”，避免覆盖用户的新数据。

## 消息版本切换

保存重说版本时，版本数据同时保存回复的 `memoryRoundId` 与 `memoryRoundIds`。

恢复旧版本时执行：

1. 回滚当前回复分支的记忆事务；
2. 恢复目标回复分支的记忆事务；
3. 两步都成功后才替换聊天消息；
4. 若目标分支恢复失败，系统自动重做当前分支，保持切换前状态。

因此相同可见回复但不同记忆写入，也会被视为不同版本，不再只按正文去重。

## 角色自主收藏

角色在回复中执行的自主收藏原本直接写入收藏记忆表。本次将它接入同一个轮次事务：

- 新增收藏可以随“重回”删除并随版本恢复；
- 更新已有收藏会保存完整前后镜像；
- 用户手动收藏不进入 AI 轮次事务，不会被“重回”误删。

## 兼容性

- `STORE_VERSION` 保持为 `3`，覆盖程序文件不会清空现有记忆。
- 旧数据没有事务日志时，“重回”仍可正常删除回复，只是无法追溯撤销旧版本已经写入的记忆。
- 新事务日志最多保留 300 个轮次，随角色数据一起进入 IndexedDB 和完整备份。
- 页面脚本增加缓存参数，避免浏览器继续使用旧的聊天或记忆内核文件。

## 主要修改文件

- `js/features/memory_v3/memory_core_v3.js`
- `js/features/memory_v3/memory_engine_v3.js`
- `js/features/memory_v3/memory_compat_v3.js`
- `js/modules/chat_ai.js`
- `js/modules/msg_version.js`
- `js/modules/favorites.js`
- `index.html`
