# neo-bpsys Announcement Center

React + Fluent UI v9 管理界面与 Cloudflare Worker API，共同部署为一个 Workers 项目。公告正文和 manifest 永久存放在 [PLFJY/neo-bpsys-announce-source](https://gitcode.com/PLFJY/neo-bpsys-announce-source)；KV 只存管理员 Session。

## 本地开发

需要 Node.js 22+ 和 pnpm 11。

```bash
pnpm install
pnpm dev
```

在项目根目录创建不提交的 `.dev.vars`：

```dotenv
ADMIN_USERNAME=your-admin-name
ADMIN_PASSWORD=your-strong-password
GITCODE_TOKEN=your-gitcode-token
```

本地开发使用 Wrangler 模拟 `SESSION_KV`。`pnpm build` 编译 React 和 Worker，`pnpm typecheck` 单独检查 TypeScript。

## Cloudflare 配置与部署

`wrangler.jsonc` 中已声明 `SESSION_KV`，但其 `id` 是占位符。先在 Cloudflare 创建 KV namespace，再仅替换这个 `id`。已有同名 namespace 时直接使用其 ID。不要用占位符部署。

```bash
pnpm exec wrangler kv namespace create SESSION_KV
```

在 Cloudflare 为本 Worker 配置以下 **Secret**：

```text
ADMIN_USERNAME
ADMIN_PASSWORD
GITCODE_TOKEN
```

可以用 Cloudflare Dashboard 设置，或分别执行 `pnpm exec wrangler secret put ADMIN_USERNAME`、`pnpm exec wrangler secret put ADMIN_PASSWORD`、`pnpm exec wrangler secret put GITCODE_TOKEN`。这些值不要写进仓库，也不要在部署时用配置文件覆盖现有 Secret。

可选普通 vars：`GITCODE_OWNER`、`GITCODE_REPO`、`GITCODE_BRANCH`。缺省分别为 `PLFJY`、`neo-bpsys-announce-source`、`main`，所以默认部署无需添加。GitCode Token 必须能够读取并修改该仓库文件。

完成绑定和 Secret 配置后：

```bash
pnpm deploy
```

## GitCode 数据仓库

目标仓库需要存在且有 `main` 分支。可以是只有一个初始提交的空内容仓库；不需要手工创建 `manifest.json` 或 `announcements/`。首条公告发布时，Worker 先写 `announcements/{id}.json`，再创建 `manifest.json`。之后的公告会增量更新 manifest。

公开接口是 `GET /api/public/v1/manifest` 和 `GET /api/public/v1/announcements/:id`，仅返回启用的公告。manifest 每条公告包含相对于 `https://raw.gitcode.com/PLFJY/neo-bpsys-announce-source/raw/main/` 的正文 `path`、修订号与公告 JSON 原始字节的 SHA-256，供客户端获取正文并判断缓存是否需要更新。

公告写入分为两次 GitCode 提交。如果正文提交成功而 manifest 提交因网络故障或并发冲突失败，可能留下未列入 manifest 的文件。该文件不会出现在公开 manifest 中，后续新建会跳过它的 ID；管理员需要在 GitCode 手工检查和清理这类孤立文件。编辑时如第二次提交失败，公开公告接口会通过 SHA-256 校验拒绝不一致内容，需在 GitCode 修复或重试编辑。
