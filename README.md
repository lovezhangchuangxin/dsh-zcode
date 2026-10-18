# dsh-zcode

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）中使用智谱 **GLM Coding Plan**：通过 ZCode 账号登录，走官方客户端同款链路获取短期项目令牌（PAT），以 Anthropic Messages 协议调用 GLM 模型。

## 特性

- **官方同款登录链路**：`zcode.z.ai` CLI 轮询式 OAuth，浏览器确认后自动完成，凭据存入 dsh 凭据库；
- **短期项目令牌（PAT）**：每请求自动签发、内存缓存、到期前自动续签、401 按指纹废弃重签——服务端计量视角与官方客户端一致（`clientType: "zcode"` / `usageScene: "CODING_PLAN"`）；
- **自带登录 UI**：在 Settings 面板注册 **ZCode (BigModel)** 设置页（dsh 宿主没有通用的第三方登录入口）；
- **额度可视**：对话底栏徽章实时显示 5 小时窗口剩余与重置倒计时（仅当前会话使用 zcode-glm 模型时出现），设置页有完整额度卡（5 小时窗口 + 令牌额度 + 重置时间 + 套餐等级）；
- **稳定设备身份**：自动生成 UUID 并持久化，等价于官方客户端安装时生成的设备号；
- **流式推理**：Anthropic Messages 协议 + SSE，思考强度（effort）可调，内置空闲看门狗。

## 环境要求

- dsh ≥ `0.2.0-rc.2`（npm 安装版即可，已在 `0.2.0-rc.2` 上验证；`0.0.x` 运行时缺少凭据记录 API，无法工作）；
- dsh 宿主进程 Node ≥ 22.15（`module.registerHooks`）。

## 工作原理

插件完整复刻了 ZCode 官方客户端的鉴权链路：

1. **登录**：`zcode.z.ai` 的 CLI 轮询式 OAuth（`/api/v1/oauth/cli/init` → 浏览器授权 → `/api/v1/oauth/cli/poll/{flow_id}`），拿到 BigModel 业务 access token，存入 dsh 凭据库（`grant` 记录）。
2. **换证**：每次请求前，用登录 token 走 BigModel 管理接口三步链：`getCustomerInfo` 定位默认机构/项目 → 查找/创建 `zcode-api-key` → 以 `clientType: "zcode"` 签发**短期项目令牌（PAT）**。内存缓存，到期前 ~2 分钟自动续签，401 时按指纹废弃重签。
3. **推理**：`POST https://open.bigmodel.cn/api/anthropic/v1/messages`（Anthropic Messages 协议，SSE 流式），携带 PAT（`x-api-key` + `Authorization`）与官方客户端来源头（`User-Agent: ZCode/<version>`、`X-ZCode-App-Version`、`X-Device-Mid`、`X-Title` 等）。

服务端的 Coding Plan 计量与客户端加成以 PAT 的签发上下文为主要识别载体，因此本插件发出的请求在服务端计量视角与官方客户端等价。

### 登录入口（为什么自带设置页）

dsh 宿主没有通用的「列出所有 authorization flow」界面——内置账号页只接 DeepSeek 平台流程，所以插件自带 UI：宿主侧在 host web server 上挂 5 条仅限回环地址的插件路由（`/plugins/dsh-zcode/status|signin|cancel|signout|quota`，写操作需状态文档下发的进程内 control key，`quota` 走官方同款 `GET /api/monitor/usage/quota/limit` 并带 60 秒缓存），浏览器侧是一个 `d.client` 模块（`lib/client.js`，ModuleLoader 封套），在 Settings 面板注册设置页、在对话输入栏右侧注册额度徽章。两侧共享 `src/webui-protocol.ts` 的线上契约。

### 宿主模块绑定（为什么有 `lib/boot.js`）

dsh 发布版 CLI 把全部 `@deepseek-ai/*` 包放在 CLI 私有的 `node_modules` 里，不在任何 profile 插件会搜索的解析路径上；而 pnpm 安装本插件时会在插件旁自动装入 npm 上的旧版包。若直接静态导入，插件拿到的会是旧版且与宿主不同实例的类（`instanceof LlmAdapter` / `instanceof LlmError` 等身份校验会失败）。

因此包入口是 `lib/boot.js`：它从 `process.argv[1]` / `process.execPath` 向上定位正在运行的 dsh CLI（识别包名 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-root`），用 `createRequire` 解析宿主自己的 `dsh-llm`、`dsh-credentials`、`dsh-authorization`、`schemastery`，注册一个仅作用于本插件产物的 `module.registerHooks` 解析钩子，再加载真正的插件体——插件内所有宿主符号都与宿主进程是同一模块实例（对 `LlmAdapter` 继承、`LlmError` 抛出、`Config` 校验至关重要）。

特殊环境可用 `DSH_ZCODE_HOST` 环境变量直接指定 CLI 安装目录。

## 安装

```sh
cd dsh-zcode
pnpm install
pnpm build        # 产出 lib/boot.js + lib/plugin.js（宿主半体）与 lib/client.js（浏览器半体）
```

接入 dsh profile——Web 端 Plugins 页面安装，或直接在 profile 目录执行：

```sh
pnpm --dir ~/.dsh/profiles/<name> add link:/Users/you/path/to/dsh-zcode
```

然后在 profile 的 `cordis.patch.yml` 中确认条目（安装 bundle 时自动添加）：

```yaml
- id: dsh-zcode
  name: dsh-zcode
```

> 修改插件代码后需重启 dsh 进程——运行中的进程缓存了模块。

## 使用

1. **登录**：Settings → **ZCode (BigModel)** → 「使用 BigModel 账号登录」。浏览器打开 bigmodel.cn 授权页，确认后插件自动完成（无需本地回调）；页面轮询状态直到登录成功。
2. **选模型**：Settings → Models 里出现 **ZCode GLM (Coding Plan)** 路由（无需 API key）。模型选择器中选择 `GLM-5.3` / `GLM-5.2` / `GLM-5-Turbo`。

## 配置（cordis.patch.yml 的 `config:` 段）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `baseURL` | `https://open.bigmodel.cn/api/anthropic/v1` | 推理端点（Anthropic 惯例：base 含 `/v1`，adapter 追加 `/messages`） |
| `appVersion` | `3.15.1` | 来源头与 PAT 签发上报的客户端版本 |
| `deviceMid` | 空（自动生成） | 稳定设备号。留空时插件首次启动生成 UUID 并持久化到 dsh 凭据库（`dsh-zcode/device` 记录，跨重启、跨登出保持）；配置显式值时优先生效 |
| `models` | GLM-5.3 / GLM-5.2 / GLM-5-Turbo | 模型目录（id/name/contextWindow/maxTokens/thinking） |
| `defaultEffort` | `high` | 思考强度：off / minimal / low / medium / high |
| `defaultMaxTokens` | `131072` | 默认输出上限 |
| `streamIdleTimeoutMs` | `120000` | 流式空闲超时（毫秒） |

完整示例：

```yaml
- id: dsh-zcode
  name: dsh-zcode
  config:
    defaultEffort: high
    deviceMid: 00000000-1111-2222-3333-444444444444   # 可选；留空则自动生成
```

## 故障排查

| 症状 | 处置 |
| --- | --- |
| `MISSING_CREDENTIAL (zcode_not_signed_in)` | 未登录。Settings → ZCode (BigModel) 完成登录。 |
| `zcode_login_expired` / 登录后仍报凭据不可用 | 登录态过期，重新登录一次。 |
| 推理报 HTTP 404 / `INVALID_REQUEST` | `baseURL` 是不带 `/v1` 的旧值。新版会自动迁移精确等于旧默认值的配置；自定义值请确认以 `/v1` 结尾。 |
| 改了插件代码不生效 | 运行中的 dsh 缓存模块，重启 dsh。 |
| Settings 里没有 ZCode (BigModel) 入口 | 浏览器半体未加载：确认 `pnpm build` 产出了 `lib/client.js`、profile 链接的是本仓库、dsh 已重启。 |
| 登录按钮点了没反应 | 状态路由不可达（dsh 未重启或宿主无 web server），页面会显示读取失败提示；重启 dsh 后重试。 |

## 已知限制

- **仅文本**：第一版不支持图片附件（图片块会显式报 `UNSUPPORTED_CONTENT`）。
- **登录态过期后需重新登录**：官方客户端同样未实现 refresh token 刷新（`refreshToken` 已随 grant 保存，预留给未来）。
- **条款风险**：本插件把你的个人 Coding Plan 订阅接入第三方 harness，使用官方 App 同款接口与你自己的凭据，但可能不符合智谱服务条款；服务端策略变更可能随时导致失效。请自行评估，保持正常使用强度。

## 开发

```sh
pnpm typecheck   # 只对 src/ 严格把关（vendor 源码差异不计入）
pnpm build       # esbuild：宿主半体 → lib/boot.js + lib/plugin.js；浏览器半体 → lib/client.js（scripts/build-client.mjs 封进 ModuleLoader 信封）
```

类型检查通过 tsconfig `paths` 对齐本机 dsh 源码仓库（`../../sources/deepseek-harness`）；调整 dsh 源码位置时同步修改 `tsconfig.json`。

仓库结构：

```
src/
  plugin.ts          宿主入口：provider/adapter 注册、授权流、web UI 桥接线
  boot.ts            宿主模块绑定（解析钩子，见上文）
  adapter.ts         Anthropic Messages 适配器（流式、空闲看门狗、PAT 注入）
  bigmodel-pat.ts    PAT 三步链与缓存
  quota.ts           Coding Plan 额度拉取（60s 缓存）
  zcode-oauth.ts     zcode.z.ai 轮询式 OAuth
  device-id.ts       持久化设备号
  webui.ts           登录 UI 宿主侧：5 条回环路由 + begin() 驱动
  webui-protocol.ts  宿主/浏览器共享的线上契约
  client/            浏览器半体：Settings 设置页、额度卡与底栏徽章（React，无宿主依赖）
scripts/
  build-client.mjs   客户端封套构建
```

## License

MIT © [lovekeqing](./LICENSE)
