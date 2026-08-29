# 文本创作批次 0 基线冻结记录

执行日期：2026-08-16  
支线：`text-creation-optimization`  
批次：`0`  
状态：完成

## 执行范围

本批次只核对原始基线、建立增量快照、记录哈希和运行现有测试，没有修改任何文本创作运行代码。

## 原始基线核对

原始 manifest：

`backups/text-creation-optimization-20260816/baseline/manifest.json`

核对结果：9/9 文件存在且 SHA-256 完全一致，差异数为 0。

## 批次 0 增量快照

快照目录：

`backups/text-creation-optimization-20260816/batch-0-preimplementation-20260816-2137/`

快照 manifest：

`backups/text-creation-optimization-20260816/batch-0-preimplementation-20260816-2137/manifest.json`

本次冻结 11 个文件，包括文本运行文件、样式、共享受限入口、基线 references、测试文件、原支线规范和 V2 方案。源文件与快照逐文件复核为 11/11 一致。

## 基线测试

### 已通过

- `node scripts/test-text-workspace.cjs`：21/21；
- `npm test`：17/17。

### 环境阻塞

- `node scripts/test-text-workspace-responsive-runtime.cjs`：`TypeError: fetch failed`；
- 原因：当前没有可连接的 Electron/CDP 页面；
- 结论：记录为环境阻塞，不能计为 UI 验收通过，也不判定为文本代码失败；
- 后续：隔离预览环境可连接后重新执行真实多视口测试。

## 运行代码状态

- 文本创作运行代码未修改；
- 豆包、无限画布、任务后台、任务坞、模型网关和既有调度器未修改；
- 当前可以进入批次 A；
- 批次 A 开始前继续以本批次快照作为回滚点。

## 批次 A 预定范围

1. 三栏文本工作台框架；
2. 左右分隔线拖动；
3. 双击恢复默认宽度；
4. 左右侧栏收起和展开；
5. 按租户与项目保存布局状态；
6. 保证正文最小编辑宽度；
7. 自动保存状态、未保存恢复、撤销和重做的安全增强；
8. 新增布局与状态隔离测试。

批次 A 不接入真实 AI 生成，不修改模型网关公共逻辑，也不实施批次 B 的素材库写入能力。
