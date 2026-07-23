# Repository Inspection (M3A)

`inspect_repository` 只读扫描目标仓库，生成 `RepositoryInventory`。

## 识别内容

语言、框架、包管理器、入口、源码/测试目录、构建/测试/Lint 命令线索、Git 状态摘要。

第一版优先：Node/TypeScript、Python、混合 Node+Python。

## 安全约束

- 路径归一化；符号链接目录不跟随（防越界）
- `maxFiles` / `maxFileBytes` 限制
- 跳过 `node_modules`、`.git`、`dist`、`coverage`、venv 等
- 不读取 `.env` / 私钥 / 凭据类路径内容
- **不执行** `npm install` / `pip install` 等安装命令

## 限制

命令字段来自 `package.json` scripts 与常见约定推断，不是保证可执行的权威命令列表。CI 文件存在性可用于后续扩展，当前库存以语言/脚本为主。
