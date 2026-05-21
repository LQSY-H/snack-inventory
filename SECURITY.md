# 安全配置说明

本项目通过环境变量管理密钥，请勿将 `.env` 或含真实密钥的配置文件提交到公开仓库。

## 必需变量

- `JWT_SECRET`：至少 16 个字符，用于签发登录令牌

生成示例：

```bash
npm run gen:secret
# 或
openssl rand -base64 24
```

## 可选：管理员自动初始化

若希望在首次启动时自动创建或提升一名管理员，可设置：

- `DEFAULT_ADMIN_USERNAME`
- `DEFAULT_ADMIN_PASSWORD`

若不设置，启动时会跳过管理员初始化，已有用户数据不受影响。

## 建议

- 生产环境使用强密码，并定期更换 `JWT_SECRET`
- 上传目录与数据库文件应定期备份
- 反向代理层启用 HTTPS
