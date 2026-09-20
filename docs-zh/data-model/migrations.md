# 前向数据库迁移与版本控制

> **历史章节映射：** 原 `docs-zh/07-data-model.md §6，§8`。

## 6. 迁移

### 核心 schema

只向前（forward-only）、带版本号，位于 `packages/kernel/src/migrations/`。每个迁移是一个编号模块，在事务中应用；已应用的版本会被记录。

```sql
CREATE TABLE schema_migrations (
  namespace   TEXT NOT NULL,                 -- 'core' or 'plugin:<id>'
  version     INTEGER NOT NULL,
  applied_at  INTEGER NOT NULL,
  PRIMARY KEY (namespace, version)
);
```

`down` 迁移只为开发而存在。在生产环境中，用旧版应用打开更新过的数据库会拒绝启动并给出解释性提示，而不是尝试回滚 —— 应用到一半的降级比一次干脆的失败更糟。

> **每个迁移的语句与其记账行在同一个事务中一起提交。** 这是承重结构，不是整洁癖：没有它，
> 一条多语句迁移中途被打断时会留下"表已建好、版本未记录"的状态，下一次启动就会重跑它并撞上
> `table already exists` —— 之后的每一次启动都是如此。数据库将永久无法启动，除了手删文件
> 别无他法。因此 `MigrationDb` 要求实现 `transaction()` 方法；它不是可选项。`BEGIN IMMEDIATE`
> 会先取写锁，而不是在事务中途再升级。

### 插件拥有的 schema

一个只允许核心建表的插件平台算不上真正的平台。插件可以声明自己的：

```ts
await ctx.db.defineSchema('plugin:@BBeBee/plugin-scrobble', [
  {
    version: 1,
    up: `CREATE TABLE {{ns}}_submissions (
           id TEXT PRIMARY KEY,
           play_id TEXT NOT NULL,
           submitted_at INTEGER,
           status TEXT NOT NULL
         )`,
  },
  { version: 2, up: `CREATE INDEX {{ns}}_status ON {{ns}}_submissions(status)` },
])
```

规则：

- `{{ns}}` 展开为由插件 id 派生的、经过清洗的前缀，因此归属在 schema 中一目了然。该变换是
  **有损的** —— `-`、`.`、`_` 都折叠为 `_`，于是 `plugin:a-b` 与 `plugin:a.b` 得到同一个
  `plugin_a_b`。因此唯一性由另一道机制保证：`schema_namespaces` 表记录每个前缀的归属
  命名空间，第二个命名空间来认领同一前缀时会以 `NamespaceCollisionError` 拒绝，
  而不是悄悄共享表。
- 插件只能写自己的表，并且只能为 `plugin:<自己的 instance id>` 调用 `defineSchema` ——
  否则它就能认领 `core`、霸占目录。**目前没有任何第一方插件自带自己的 schema** —— 扫描器、
  播放器和音源 UI 都在 `db:read:core`/`db:write:core` 之下读写*核心*表。下述 `{{ns}}`
  机制已在内核中实现并测试过，但尚无任何随包插件真正使用它。
  读取核心表需要 `db:read:core`，改写核心表的行需要
  `db:write:core` —— 这是另一项独立授权，不会随前者附带
  （[03 §7](../plugins/capabilities.md#能力语法)）。每条 `up` 都是**单条语句**：驱动会执行第一条
  并默默丢弃其余的，因此多语句字符串会在任何东西执行之前就被拒绝，而不是执行到一半、
  版本还被记了账（[04 §5](../services/contracts.md#5-ctxdb--sql)）。数组形式正是为此而设。
  `ATTACH`/`DETACH` 一律拒绝，因为它们会把数据库句柄变成任意文件读写原语。
- ⚠️ 这项检查是**对表标识符的正则匹配，不是 SQL 解析器**。它按"失败即拒绝"（fail closed）
  设计 —— 无法明确归属的标识符一律当作外来表处理 —— 它拦得住寻常失误与顺手越界，却拦不住
  蓄意为之的作者，反正后者与运行时同处一室
  （[03 §7](../plugins/concepts.md#门实际运行的位置)）。
- 迁移在 `ctx.plugin()` 内部运行，因此迁移失败只影响该插件。
- **卸载**时提供"删除数据" —— 丢弃该命名空间的表及对应的 `schema_migrations` 行 —— 或"保留数据"，让它们休眠，以便重装后从上次中断处继续。默认保留是更安全的选择。

### 数据保留

`play_history` 会无限制地增长。一次维护过程会保留最近 2 年的完整行（可配置），把更早的行折叠进 `track_stats` 后删除。`cache_entries` 按 §4.11 处理。其余所有数据的大小都以用户曲库的规模为上界。

---


---

## 8. 下一步阅读

[08 —— UI 架构](../ui/architecture.md) 讲述这份数据如何抵达两个不同的视图层，而其中任何一个都不占有这份数据。
