# QingH Studio — Cloudflare 部署教程

> **费用**：全部使用 Cloudflare 免费套餐，0 元上线。月费 5 元会员是后续的业务层功能。

---

## 架构概览

```
用户手机/电脑 → Cloudflare Pages (静态前端 HTML)
                     ↓ API 调用
               Cloudflare Workers (后端 API)
                     ↓ 读写
               Cloudflare D1 (SQLite 数据库)
```

| 服务 | 免费额度 | 用途 |
|------|---------|------|
| Cloudflare Pages | 无限请求, 500次构建/月 | 托管前端 HTML |
| Cloudflare Workers | 10万请求/天 | 后端 API |
| Cloudflare D1 | 5GB 存储, 500万行读/天 | 数据库 |

---

## 第一步：注册 Cloudflare 账号

1. 打开 https://dash.cloudflare.com/sign-up
2. 用邮箱注册（不需要绑信用卡）
3. 验证邮箱后登录

## 第二步：安装 Wrangler CLI

Wrangler 是 Cloudflare 的命令行管理工具。

```bash
# 需要先安装 Node.js (推荐 v18+)
# macOS/WSL:
brew install node

# Windows:
# 去 https://nodejs.org 下载安装包

# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login
```

## 第三步：创建 D1 数据库

```bash
# 创建数据库
wrangler d1 create qingh-db

# 输出会显示 database_id，例如：
# ✅ Created database 'qingh-db' with id: abc123-def456-...
```

复制输出的 `database_id`，打开 `wrangler.toml`，替换 `YOUR_D1_DATABASE_ID`。

## 第四步：初始化数据库表

```bash
# 使用 schema.sql 建表
wrangler d1 execute qingh-db --file=./schema.sql

# 验证：查看所有表
wrangler d1 execute qingh-db --command="SELECT name FROM sqlite_master WHERE type='table'"
```

应该看到 `users`, `sessions`, `messages`, `worlds`, `characters`, `supplements`, `uploaded_files`。

## 第五步：配置 JWT 密钥

在 `wrangler.toml` 中，把 `JWT_SECRET` 改成你自己的随机字符串：

```toml
[vars]
JWT_SECRET = "随便打一串乱码比如 kh38sjf92jf0skl2jf9s02fj"
```

同时在 `worker.js` 第 11 行的 `JWT_SECRET_KEY` 也改成同一个值（部署后由环境变量覆盖）。

## 第六步：部署 Worker

```bash
# 在 cloudflare 目录下运行
cd cloudflare

# 部署 Worker
wrangler deploy

# 部署成功后会输出：https://qingh-studio.你的用户名.workers.dev
```

记住这个 Worker URL，后面前端需要用到。

## 第七步：部署前端到 Cloudflare Pages

### 方式 A：直接上传（最简单）

1. 打开 https://dash.cloudflare.com → 左侧菜单 → **Workers 和 Pages** → **Pages**
2. 点击 **上传资产**
3. 项目名称填 `qingh-studio`
4. 把 `index.html` 拖进去（复制到项目根目录）
5. 点击 **部署**

### 方式 B：通过 Git（推荐，自动更新）

1. 在 GitHub 创建新仓库 `qingh-studio`
2. 把 `index.html` 提交上去
3. 在 Cloudflare Pages → 连接到 Git → 选择仓库
4. 构建命令留空（纯 HTML），部署目录填 `/`
5. 部署

## 第八步：配置前端 API 地址

打开部署后的 `index.html`，在代码中搜索 `API_BASE_URL`，替换为你的 Worker 地址：

```javascript
const API_BASE_URL = 'https://qingh-studio.你的用户名.workers.dev';
```

> **已内置在 index.html 中**：首次部署前，在页面顶部附近找到 `CLOUDFLARE_WORKER_URL` 变量，改成你的 Worker 地址即可。

---

## 月费 5 元会员说明

当前版本已内置 VIP 字段（`users.vip_level`），但支付功能需要额外对接：

1. 接入微信支付 / 支付宝（需要企业资质）
2. 或使用第三方支付平台（如 PayJS、xorpay 等，个人可申请）
3. 支付回调 → Worker API 更新 `vip_level = 1` + `vip_expires_at`

后续需要支付对接时可以继续扩展。

---

## 验证部署

1. 打开 Pages 域名 → 看到 QingH Studio 界面
2. 点击右上角 👤 头像 → 注册账号
3. 填写 API Key（在 ⚙️ 设置里）
4. 开始聊天 → 数据自动同步到云端
5. 换个设备登录 → 聊天记录都在

---

## 常用命令

```bash
# 查看 Worker 日志
wrangler tail

# 更新 Worker
wrangler deploy

# 查看数据库
wrangler d1 execute qingh-db --command="SELECT COUNT(*) FROM users"

# 本地开发（Worker 跑在本地）
wrangler dev

# 删除某个用户
wrangler d1 execute qingh-db --command="DELETE FROM users WHERE email='test@example.com'"
```

---

## 免费额度够用吗？

| 场景 | 消耗 | 月成本 |
|------|------|--------|
| 100 个活跃用户 | ~3万 API 请求/天 | ¥0 |
| 1000 个活跃用户 | ~30万 API 请求/天 | 需升级 Workers ($5/月) |
| 10000 条消息 | ~1MB D1 存储 | ¥0 |

对于个人或小团队使用，完全免费。规模扩大后再升级即可。
