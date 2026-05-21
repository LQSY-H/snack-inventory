# 零食库存管理系统

基于 Node.js + Express + SQLite 的轻量级零食库存 Web 应用，支持用户注册登录、分类管理、库存出入库、保质期提醒与图片上传。

## 功能概览

- 用户注册 / 登录（JWT + Cookie）
- 零食增删改查、分类筛选与关键词搜索
- 库存入库 / 出库 / 调整及操作记录
- 保质期计算与临期 / 过期提醒
- 图片上传与缩略图生成
- 管理员后台：分类管理、用户管理、全站库存记录

## 环境要求

- Node.js 18 或更高版本
- npm

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制示例配置并填写：

```bash
cp .env.example .env
```

编辑 `.env`，至少设置 `JWT_SECRET`（至少 16 字符）：

```env
JWT_SECRET=your_random_secret_here
```

生成随机密钥：

```bash
npm run gen:secret
```

### 3. 启动服务

开发 / 直接运行：

```bash
npm start
```

默认监听 `3000` 端口，访问路径为 `/snacks/`。

健康检查：

```bash
curl http://127.0.0.1:3000/snacks/api/health
```

## 管理员账户配置

管理员通过环境变量在**首次启动**时自动创建；若同名用户已存在，则将其角色提升为 `admin`。

### 方式一：`.env` 文件（推荐本地开发）

在项目根目录的 `.env` 中设置：

```env
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=your_secure_password
```

对应示例见 `.env.example`。

### 方式二：`ecosystem.config.js`（推荐 PM2 部署）

编辑 `ecosystem.config.js` 中 `env` 区块：

```js
DEFAULT_ADMIN_USERNAME: "admin",
DEFAULT_ADMIN_PASSWORD: "your_secure_password",
JWT_SECRET: "your_random_secret_here",
```

修改后需重启进程才能生效。

### 方式三：系统环境变量

```bash
export JWT_SECRET="your_random_secret"
export DEFAULT_ADMIN_USERNAME="admin"
export DEFAULT_ADMIN_PASSWORD="your_secure_password"
npm start
```

> **说明**
>
> - 若不设置 `DEFAULT_ADMIN_*`，服务仍可正常启动，但不会自动创建管理员；普通用户可通过注册接口自行注册。
> - 已有管理员账号时，再次设置上述变量不会重置密码，仅会在用户不存在时创建，或将其角色设为 `admin`。
> - 管理员登录后，在前台点击「后台管理」进入 `/snacks/admin`，可管理分类、用户与库存记录。

## 可选配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务监听端口 |
| `BASE_PATH` | `/snacks` | 应用 URL 前缀，需与前端 `base href` 一致 |
| `JWT_SECRET` | （必填） | JWT 签名密钥 |
| `DEFAULT_ADMIN_USERNAME` | （可选） | 初始管理员用户名 |
| `DEFAULT_ADMIN_PASSWORD` | （可选） | 初始管理员密码 |

## 目录结构

```
.
├── server.js              # 后端入口与 API
├── public/                # 前端静态页面
│   ├── index.html         # 用户前台
│   └── admin.html         # 管理后台
├── data/                  # SQLite 数据库（首次启动自动创建）
├── uploads/               # 上传图片
│   ├── original/          # 原图
│   └── thumb/             # 缩略图
├── .env.example           # 环境变量示例
├── ecosystem.config.js    # PM2 配置示例
└── package.json
```

## 部署流程

以下以 PM2 为例，其他进程管理器可按同样环境变量配置。

### 1. 获取代码并安装依赖

```bash
git clone <your-repo-url>
cd snack-inventory-system
npm install --production
```

### 2. 配置密钥与管理员

```bash
cp .env.example .env
# 编辑 .env，填写 JWT_SECRET 与 DEFAULT_ADMIN_* 
```

或使用 `ecosystem.config.js` 统一管理（部署前请将占位符替换为真实值）。

### 3. 使用 PM2 启动

```bash
pm2 start ecosystem.config.js
pm2 save
```

查看状态：

```bash
pm2 status
pm2 logs snack-inventory
```

### 4. 反向代理（可选）

若需通过域名或 HTTPS 对外访问，可在 Nginx、Caddy 等反向代理中将路径 `/snacks` 转发至本服务端口（默认 `3000`）。

示例（Nginx）：

```nginx
location /snacks/ {
    proxy_pass http://127.0.0.1:3000/snacks/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 10m;
}
```

### 5. 验证

- 浏览器访问 `http://<host>:<port>/snacks/`
- 使用配置的管理员账号登录
- 确认 `/snacks/api/health` 返回 `{"ok":true,...}`

### 6. 更新部署

```bash
git pull
npm install --production
pm2 restart snack-inventory
```

## 数据说明

- 数据库文件位于 `data/snacks.db`，首次启动时自动建表，**本仓库不包含任何用户或业务数据**。
- 上传图片保存在 `uploads/` 目录，已在 `.gitignore` 中排除，需自行备份。

## 许可证

ISC
