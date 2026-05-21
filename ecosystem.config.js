module.exports = {
  apps: [
    {
      name: "snack-inventory",
      script: "server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        BASE_PATH: "/snacks",
        // 请在部署前替换为随机密钥，例如：npm run gen:secret
        JWT_SECRET: "CHANGE_ME_TO_A_RANDOM_SECRET_AT_LEAST_16_CHARS",
        // 可选：首次启动时自动创建管理员账号
        DEFAULT_ADMIN_USERNAME: "admin",
        DEFAULT_ADMIN_PASSWORD: "CHANGE_ME",
      },
    },
  ],
};
