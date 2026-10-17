# dsh-zcode

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）中使用智谱 **GLM Coding Plan**：通过 ZCode 账号登录，走官方客户端同款链路获取短期项目令牌（PAT），以 Anthropic Messages 协议调用 GLM 模型。

## 工作原理

插件完整复刻了 ZCode 官方客户端的鉴权链路：

1. **登录**：`zcode.z.ai` 的 CLI 轮询式 OAuth（`/api/v1/oauth/cli/init` → 浏览器授权 → `/api/v1/oauth/cli/poll/{flow_id}`），拿到 BigModel 业务 access token，存入 dsh 凭据库（`grant` 记录）。
2. **换证**：每次请求前，用登录 token 走 BigModel 管理接口三步链：`getCustomerInfo` 定位默认机构/项目 → 查找/创建 `zcode-api-key` → 以 `clientType: "zcode"` 签发**短期项目令牌（PAT）**。内存缓存，到期前 ~2 分钟自动续签，401 时按指纹废弃重签。
3. **推理**：`POST https://open.bigmodel.cn/api/anthropic/v1/messages`（Anthropic Messages 协议，SSE 流式），携带 PAT（`x-api-key` + `Authorization`）与官方客户端来源头（`User-Agent: ZCode/<version>`、`X-ZCode-App-Version`、`X-Device-Mid`、`X-Title` 等）。

服务端的 Coding Plan 计量与客户端加成以 PAT 的签发上下文（`clientType: "zcode"`、`usageScene: "CODING_PLAN"`）为主要识别载体，因此本插件发出的请求在服务端视角与官方客户端等价。

### 宿主模块绑定（为什么有 `lib/boot.js`）

dsh 发布版 CLI 把全部 `@deepseek-ai/*` 包放在 CLI 私有的 `node_modules` 里，不在任何 profile 插件会搜索的解析路径上；而 pnpm 安装本插件时会在插件旁自动装入 npm 上的旧版包。若直接静态导入，插件拿到的会是旧版且与宿主不同实例的类（`instanceof LlmAdapter` / `instanceof LlmError` 等身份校验会失败）。

因此包入口是 `lib/boot.js`：它从 `process.argv[1]` / `process.execPath` 向上定位正在运行的 dsh CLI（识别包名 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-root`），用 `createRequire` 解析宿主自己的 `dsh-llm`、`dsh-credentials`、`dsh-authorization`、`schemastery`，注册一个仅作用于本插件产物的 `module.registerHooks` 解析钩子，再加载真正的插件体 —— 插件内所有宿主符号都与宿主进程是同一模块实例（对 `LlmAdapter` 继承、`LlmError` 抛出、`Config` 校验至关重要）。

特殊环境可用 `DSH_ZCODE_HOST` 环境变量直接指定 CLI 安装目录。要求 Node ≥ 22.15（`registerHooks`）。修改插件代码后需重启 dsh 进程（运行中的进程缓存了模块）。

## 安装

```sh
cd dsh-zcode
pnpm install
pnpm build
```

### 接入 dsh profile

Web 端 Plugins 页面安装，或直接在 profile 目录执行：

```sh
pnpm --dir ~/.dsh/profiles/<name> add link:/Users/you/path/to/dsh-zcode
```

然后在 profile 的 `cordis.patch.yml` 中确认条目（安装 bundle 时自动添加）：

```yaml
- id: dsh-zcode
  name: dsh-zcode
```

### 登录 UI（插件自带 web 客户端半体）

dsh 宿主没有通用的「列出所有 authorization flow」界面（内置账号页只接 DeepSeek 平台流程），因此插件自带 UI：宿主侧在 host web server 上挂 4 条仅限回环地址的插件路由（`/plugins/dsh-zcode/status|signin|cancel|signout`，写操作需状态文档下发的进程内 control key），浏览器侧是一个 `d.client` 模块（`lib/client.js`，ModuleLoader 封套），在 Settings 面板注册 **ZCode (BigModel)** 设置页。两侧共享 `src/webui-protocol.ts` 的线上契约。

## 使用

1. **登录**：Settings → **ZCode (BigModel)** → 「使用 BigModel 账号登录」。浏览器打开 bigmodel.cn 授权页，确认后插件自动完成（无需本地回调）；页面会轮询状态直到登录成功。
2. **选模型**：Settings → Models 里出现 **ZCode GLM (Coding Plan)** 路由（无需 API key）。模型选择器中选择 `GLM-5.3` / `GLM-5.2` / `GLM-5-Turbo`。

## 配置（cordis.patch.yml 的 `config:` 段）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `baseURL` | `https://open.bigmodel.cn/api/anthropic/v1` | 推理端点（Anthropic 惯例：base 含 `/v1`，adapter 追加 `/messages`） |
| `appVersion` | `3.15.1` | 来源头与 PAT 签发上报的客户端版本 |
| `deviceMid` | 空（省略该头） | 稳定设备号；建议配置一个固定 UUID |
| `models` | GLM-5.3 / GLM-5.2 / GLM-5-Turbo | 模型目录（id/name/contextWindow/maxTokens/thinking） |
| `defaultEffort` | `high` | 思考强度：off / minimal / low / medium / high |
| `defaultMaxTokens` | `131072` | 默认输出上限 |
| `streamIdleTimeoutMs` | `120000` | 流式空闲超时 |

## 已知限制

- **仅文本**：第一版不支持图片附件（图片块会显式报 `UNSUPPORTED_CONTENT`）。
- **需要源码版（0.2.x）dsh**：npm 上 `0.0.1-rc.1` 的 dsh 运行时缺少凭据记录 API（`readRecord` 等），插件无法在其上工作。
- **登录态过期后需重新登录**：官方客户端同样未实现 refresh token 刷新（`refreshToken` 已随 grant 保存，预留给未来）。
- **条款风险**：本插件把你的个人 Coding Plan 订阅接入第三方 harness，使用官方 App 同款接口与你自己的凭据，但可能不符合智谱服务条款；服务端策略变更可能随时导致失效。请自行评估，保持正常使用强度。

## 开发

```sh
pnpm typecheck   # 只对 src/ 严格把关（vendor 源码差异不计入）
pnpm build       # esbuild 打包到 lib/index.js
```

类型检查通过 tsconfig `paths` 直接对齐本机 dsh 源码仓库（`../../sources/deepseek-harness`）；调整 dsh 源码位置时同步修改 `tsconfig.json`。

## License

MIT
