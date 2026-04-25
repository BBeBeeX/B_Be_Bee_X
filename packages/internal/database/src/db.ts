import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"

import type * as schema from "./schemas"
import type { DB } from "./types"

// 这里只声明统一的数据库接口，具体实现由桌面端或 React Native 入口提供。
export declare const sqlite: unknown
export declare const db: DB
export declare function initializeDB(): Promise<void>
export declare function migrateDB(): Promise<void>
export declare function getDBFile(): Promise<Blob>
export declare function exportDB(): Promise<void>
/**
 * 删除数据库文件；调用后通常需要重新加载应用以重建连接与状态。
 */
export declare function deleteDB(): Promise<void>

// 统一异步 SQLite 数据库类型，便于在共享服务层中复用。
export type AsyncDb = BaseSQLiteDatabase<"async", any, typeof schema>
