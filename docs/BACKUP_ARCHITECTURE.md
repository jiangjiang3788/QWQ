# 完整备份架构（V2.10）

完整备份使用 `ovo-full-backup` / `formatVersion: 1`，文件扩展名仍为 `.ee`，内部是 ZIP。

## 内容

- `manifest.json`：格式、应用版本、创建时间和表清单。
- `database/<table>.json`：自动枚举当前 Dexie 数据库的全部表，不裁剪角色或群组字段。
- `local-storage.json`：本地设置；GitHub Token 明确排除。
- `metadata/counts.json`：各表记录数。
- `metadata/checksums.json`：数据文件 SHA-256。

## 恢复顺序

1. 打开 ZIP 并验证格式版本。
2. 验证文件清单、JSON、记录数和 SHA-256。
3. 要求备份表结构与当前数据库完全一致。
4. 在单个 Dexie 读写事务中清空并写入全部表。
5. 写入后复核每张表数量；任一步失败由事务回滚。
6. 恢复非敏感 localStorage 设置并重新加载内存数据。

旧 gzip JSON 完整备份不再由“完整导入”入口识别；分类导入导出保留原用途。
