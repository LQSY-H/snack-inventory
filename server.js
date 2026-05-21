const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const sharp = require("sharp");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const dayjs = require("dayjs");

/** 可选：从项目根 `.env` 加载（勿提交）；命令行 `export` 的变量优先 */
(() => {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || "/snacks";
const JWT_SECRET = process.env.JWT_SECRET;
const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME;
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD;

if (!JWT_SECRET || JWT_SECRET.length < 16) {
  throw new Error(
    "JWT_SECRET is required and must be at least 16 characters. " +
      "Copy .env.example to .env and set JWT_SECRET, or: export JWT_SECRET=$(openssl rand -base64 24)",
  );
}

const ROOT = __dirname;
const DB_PATH = path.join(ROOT, "data", "snacks.db");
const UPLOAD_ORIGINAL = path.join(ROOT, "uploads", "original");
const UPLOAD_THUMB = path.join(ROOT, "uploads", "thumb");

[path.join(ROOT, "data"), UPLOAD_ORIGINAL, UPLOAD_THUMB].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path !== `${BASE_PATH}/admin.html`) return next();
  const token =
    req.cookies.token ||
    (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.redirect(`${BASE_PATH}/`);
  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== "admin") return res.status(403).send("Forbidden");
    next();
  } catch {
    return res.redirect(`${BASE_PATH}/`);
  }
});
app.use(`${BASE_PATH}/uploads`, express.static(path.join(ROOT, "uploads")));
app.use(BASE_PATH, express.static(path.join(ROOT, "public")));

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function createToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role || "user" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const token =
    req.cookies.token ||
    (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "未登录" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "登录状态已过期" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "仅管理员可访问" });
  }
  next();
}

function ownershipFilter(req, tableAlias = "") {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  if (req.user?.role === "admin") {
    return {
      where: `(${prefix}user_id = ? OR ${prefix}user_id IS NULL)`,
      params: [req.user.id],
    };
  }
  return {
    where: `${prefix}user_id = ?`,
    params: [req.user.id],
  };
}

function calcExpiryDate(productionDate, shelfLifeDays, expiryDate) {
  if (expiryDate) return dayjs(expiryDate).format("YYYY-MM-DD");
  if (productionDate && shelfLifeDays) {
    return dayjs(productionDate)
      .add(Number(shelfLifeDays), "day")
      .format("YYYY-MM-DD");
  }
  return null;
}

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS snacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    category_id INTEGER,
    stock INTEGER NOT NULL DEFAULT 0,
    production_date TEXT,
    shelf_life_days INTEGER,
    expiry_date TEXT,
    image_original TEXT,
    image_thumb TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS stock_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    snack_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (snack_id) REFERENCES snacks(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'", () => {
    // Ignore duplicate-column errors for existing databases.
  });
  db.run("ALTER TABLE categories ADD COLUMN user_id INTEGER", () => {});
  db.run("ALTER TABLE snacks ADD COLUMN user_id INTEGER", () => {});
  db.run("ALTER TABLE stock_records ADD COLUMN user_id INTEGER", () => {});
});

async function ensureDefaultAdmin() {
  if (!DEFAULT_ADMIN_USERNAME || !DEFAULT_ADMIN_PASSWORD) {
    console.warn(
      "Default admin bootstrap skipped: set DEFAULT_ADMIN_USERNAME and DEFAULT_ADMIN_PASSWORD if needed."
    );
    return;
  }
  try {
    const user = await get("SELECT * FROM users WHERE username = ?", [
      DEFAULT_ADMIN_USERNAME,
    ]);
    if (user) {
      if (user.role !== "admin") {
        await run("UPDATE users SET role = 'admin' WHERE id = ?", [user.id]);
      }
      return;
    }

    const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    await run(
      "INSERT INTO users(username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)",
      [DEFAULT_ADMIN_USERNAME, hash, dayjs().format("YYYY-MM-DD HH:mm:ss")]
    );
  } catch (e) {
    console.error("Failed to ensure default admin:", e.message);
  }
}

ensureDefaultAdmin();

async function backfillLegacyUserOwnership() {
  try {
    if (!DEFAULT_ADMIN_USERNAME) return;
    const adminUser = await get("SELECT id FROM users WHERE username = ?", [
      DEFAULT_ADMIN_USERNAME,
    ]);
    if (!adminUser) return;
    await run("UPDATE categories SET user_id = ? WHERE user_id IS NULL", [adminUser.id]);
    await run("UPDATE snacks SET user_id = ? WHERE user_id IS NULL", [adminUser.id]);
    await run("UPDATE stock_records SET user_id = ? WHERE user_id IS NULL", [adminUser.id]);
  } catch (e) {
    console.error("Failed to backfill legacy ownership:", e.message);
  }
}

backfillLegacyUserOwnership();

async function reassignSingleOwnerDataToAdmin() {
  try {
    if (!DEFAULT_ADMIN_USERNAME) return;
    const adminUser = await get("SELECT id FROM users WHERE username = ?", [
      DEFAULT_ADMIN_USERNAME,
    ]);
    if (!adminUser) return;

    const stats = await all(`
      SELECT user_id, COUNT(*) AS cnt
      FROM snacks
      WHERE user_id IS NOT NULL
      GROUP BY user_id
    `);

    if (stats.length !== 1) return;
    const onlyOwnerId = Number(stats[0].user_id);
    if (onlyOwnerId === adminUser.id) return;

    await run("UPDATE categories SET user_id = ? WHERE user_id = ?", [
      adminUser.id,
      onlyOwnerId,
    ]);
    await run("UPDATE snacks SET user_id = ? WHERE user_id = ?", [
      adminUser.id,
      onlyOwnerId,
    ]);
    await run("UPDATE stock_records SET user_id = ? WHERE user_id = ?", [
      adminUser.id,
      onlyOwnerId,
    ]);
    console.log("Legacy data owner has been reassigned to admin.");
  } catch (e) {
    console.error("Failed to reassign legacy owner data:", e.message);
  }
}

reassignSingleOwnerDataToAdmin();

async function migrateCategoriesUniqueness() {
  try {
    const info = await all("PRAGMA table_info(categories)");
    const nameCol = info.find((c) => c.name === "name");
    if (!nameCol) return;
    // Legacy schema had a global UNIQUE constraint on name.
    // Rebuild table so each user can have same category names independently.
    const hasUniqueIndex = await all("PRAGMA index_list(categories)");
    const maybeUnique = hasUniqueIndex.some((idx) => idx.unique === 1);
    if (!maybeUnique) return;

    await run("ALTER TABLE categories RENAME TO categories_old");
    await run(`CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    await run(
      "INSERT INTO categories(id, user_id, name, created_at) SELECT id, user_id, name, created_at FROM categories_old"
    );
    await run("DROP TABLE categories_old");
  } catch (e) {
    console.error("Category uniqueness migration skipped:", e.message);
  }
}

migrateCategoriesUniqueness();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_ORIGINAL),
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
});

app.post(`${BASE_PATH}/api/auth/register`, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "用户名和密码必填" });
    }
    const hash = await bcrypt.hash(password, 10);
    const createdAt = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const result = await run(
      "INSERT INTO users(username, password_hash, role, created_at) VALUES (?, ?, 'user', ?)",
      [username, hash, createdAt]
    );
    const token = createToken({ id: result.lastID, username, role: "user" });
    res.cookie("token", token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
    res.json({ message: "注册成功", username, role: "user" });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(400).json({ message: "用户名已存在" });
    }
    res.status(500).json({ message: "注册失败", error: e.message });
  }
});

app.post(`${BASE_PATH}/api/auth/login`, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await get("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) return res.status(400).json({ message: "用户名或密码错误" });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ message: "用户名或密码错误" });
    const token = createToken(user);
    res.cookie("token", token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
    res.json({ message: "登录成功", username: user.username, role: user.role });
  } catch (e) {
    res.status(500).json({ message: "登录失败", error: e.message });
  }
});

app.post(`${BASE_PATH}/api/auth/logout`, (req, res) => {
  res.clearCookie("token");
  res.json({ message: "已退出登录" });
});

app.get(`${BASE_PATH}/api/auth/me`, auth, (req, res) => {
  res.json({ user: req.user });
});

app.get(`${BASE_PATH}/api/users`, auth, requireAdmin, async (_, res) => {
  const users = await all(
    "SELECT id, username, role, created_at FROM users ORDER BY id DESC"
  );
  res.json(users);
});

app.delete(`${BASE_PATH}/api/users/:id`, auth, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId)) return res.status(400).json({ message: "用户ID错误" });
  if (targetId === req.user.id) return res.status(400).json({ message: "不能删除当前管理员自己" });

  const target = await get("SELECT id, username, role FROM users WHERE id = ?", [targetId]);
  if (!target) return res.status(404).json({ message: "用户不存在" });

  await run("DELETE FROM stock_records WHERE user_id = ?", [targetId]);
  await run("DELETE FROM snacks WHERE user_id = ?", [targetId]);
  await run("DELETE FROM categories WHERE user_id = ?", [targetId]);
  await run("DELETE FROM users WHERE id = ?", [targetId]);
  res.json({ message: `已删除用户 ${target.username}` });
});

app.get(`${BASE_PATH}/api/categories`, auth, async (req, res) => {
  const own = ownershipFilter(req, "categories");
  const rows = await all(
    `SELECT * FROM categories WHERE ${own.where} ORDER BY id DESC`,
    own.params
  );
  res.json(rows);
});

app.post(`${BASE_PATH}/api/categories`, auth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "分类名不能为空" });
    const own = ownershipFilter(req, "categories");
    const existing = await get(
      `SELECT id, name FROM categories WHERE name = ? AND ${own.where}`,
      [name, ...own.params]
    );
    if (existing) return res.json(existing);
    const result = await run(
      "INSERT INTO categories(user_id, name, created_at) VALUES (?, ?, ?)",
      [req.user.id, name, dayjs().format("YYYY-MM-DD HH:mm:ss")]
    );
    res.json({ id: result.lastID, name });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(400).json({ message: "当前账号下分类已存在" });
    }
    res.status(500).json({ message: "创建分类失败", error: e.message });
  }
});

app.delete(`${BASE_PATH}/api/categories/:id`, auth, async (req, res) => {
  const own = ownershipFilter(req);
  await run(`DELETE FROM categories WHERE id = ? AND ${own.where}`, [req.params.id, ...own.params]);
  res.json({ message: "删除成功" });
});

app.post(`${BASE_PATH}/api/upload`, auth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "未上传文件" });
    const originalPath = req.file.path;
    const thumbName = `thumb_${req.file.filename}.jpg`;
    const thumbPath = path.join(UPLOAD_THUMB, thumbName);
    await sharp(originalPath)
      .rotate() // honor EXIF orientation so portrait photos stay upright
      .resize(360)
      .jpeg({ quality: 70 })
      .toFile(thumbPath);
    res.json({
      original: `${BASE_PATH}/uploads/original/${req.file.filename}`,
      thumb: `${BASE_PATH}/uploads/thumb/${thumbName}`,
    });
  } catch (e) {
    res.status(500).json({ message: "图片处理失败", error: e.message });
  }
});

app.get(`${BASE_PATH}/api/snacks`, auth, async (req, res) => {
  const { keyword = "", categoryId } = req.query;
  const own = ownershipFilter(req, "s");
  let sql = `
    SELECT s.*, c.name as category_name
    FROM snacks s
    LEFT JOIN categories c ON s.category_id = c.id
    WHERE s.name LIKE ? AND ${own.where}
  `;
  const params = [`%${keyword}%`, ...own.params];
  if (categoryId) {
    sql += " AND s.category_id = ?";
    params.push(categoryId);
  }
  sql += " ORDER BY s.id DESC";

  const rows = await all(sql, params);
  const now = dayjs().startOf("day");
  const data = rows.map((item) => {
    const exp = item.expiry_date ? dayjs(item.expiry_date) : null;
    let daysLeft = null;
    let expiryStatus = "normal";
    if (exp && exp.isValid()) {
      daysLeft = exp.diff(now, "day");
      if (daysLeft < 0) expiryStatus = "expired";
      else if (daysLeft <= 7) expiryStatus = "warning";
    }
    return { ...item, daysLeft, expiryStatus };
  });
  res.json(data);
});

app.post(`${BASE_PATH}/api/snacks`, auth, async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.name) return res.status(400).json({ message: "名称必填" });
    const finalExpiryDate = calcExpiryDate(
      payload.production_date,
      payload.shelf_life_days,
      payload.expiry_date
    );
    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const result = await run(
      `INSERT INTO snacks
      (user_id, name, category_id, stock, production_date, shelf_life_days, expiry_date, image_original, image_thumb, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        payload.name,
        payload.category_id || null,
        Number(payload.stock || 0),
        payload.production_date || null,
        payload.shelf_life_days ? Number(payload.shelf_life_days) : null,
        finalExpiryDate,
        payload.image_original || null,
        payload.image_thumb || null,
        now,
        now,
      ]
    );
    if (Number(payload.stock || 0) > 0) {
      await run(
        "INSERT INTO stock_records(user_id, snack_id, type, quantity, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [req.user.id, result.lastID, "in", Number(payload.stock), "新增商品初始库存", now]
      );
    }
    res.json({ id: result.lastID, message: "新增成功" });
  } catch (e) {
    res.status(500).json({ message: "新增失败", error: e.message });
  }
});

app.put(`${BASE_PATH}/api/snacks/:id`, auth, async (req, res) => {
  try {
    const payload = req.body;
    const finalExpiryDate = calcExpiryDate(
      payload.production_date,
      payload.shelf_life_days,
      payload.expiry_date
    );
    const own = ownershipFilter(req);
    await run(
      `UPDATE snacks SET
      name=?, category_id=?, stock=?, production_date=?, shelf_life_days=?, expiry_date=?, image_original=?, image_thumb=?, updated_at=?
      WHERE id=? AND ${own.where}`,
      [
        payload.name,
        payload.category_id || null,
        Number(payload.stock || 0),
        payload.production_date || null,
        payload.shelf_life_days ? Number(payload.shelf_life_days) : null,
        finalExpiryDate,
        payload.image_original || null,
        payload.image_thumb || null,
        dayjs().format("YYYY-MM-DD HH:mm:ss"),
        req.params.id,
        ...own.params,
      ]
    );
    res.json({ message: "更新成功" });
  } catch (e) {
    res.status(500).json({ message: "更新失败", error: e.message });
  }
});

app.delete(`${BASE_PATH}/api/snacks/:id`, auth, async (req, res) => {
  const own = ownershipFilter(req);
  await run(`DELETE FROM snacks WHERE id = ? AND ${own.where}`, [req.params.id, ...own.params]);
  res.json({ message: "删除成功" });
});

app.post(`${BASE_PATH}/api/snacks/:id/stock`, auth, async (req, res) => {
  try {
    const { type, quantity, note } = req.body;
    const qty = Number(quantity);
    if (!["in", "out", "adjust"].includes(type)) {
      return res.status(400).json({ message: "库存类型错误" });
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ message: "数量必须为正整数" });
    }

    const own = ownershipFilter(req);
    const snack = await get(
      `SELECT * FROM snacks WHERE id = ? AND ${own.where}`,
      [req.params.id, ...own.params]
    );
    if (!snack) return res.status(404).json({ message: "商品不存在" });

    let newStock = snack.stock;
    if (type === "in") newStock += qty;
    if (type === "out") {
      if (snack.stock < qty) return res.status(400).json({ message: "库存不足" });
      newStock -= qty;
    }
    if (type === "adjust") newStock = qty;

    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    await run("UPDATE snacks SET stock=?, updated_at=? WHERE id=?", [
      newStock,
      now,
      req.params.id,
    ]);
    await run(
      "INSERT INTO stock_records(user_id, snack_id, type, quantity, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [req.user.id, req.params.id, type, qty, note || "", now]
    );
    res.json({ message: "库存更新成功", stock: newStock });
  } catch (e) {
    res.status(500).json({ message: "库存更新失败", error: e.message });
  }
});

app.get(`${BASE_PATH}/api/stock-records`, auth, async (req, res) => {
  const own = ownershipFilter(req, "r");
  const rows = await all(`
    SELECT r.*, s.name as snack_name
    FROM stock_records r
    JOIN snacks s ON r.snack_id = s.id
    WHERE ${own.where}
    ORDER BY r.id DESC
    LIMIT 500
  `, own.params);
  res.json(rows);
});

app.get(`${BASE_PATH}/api/health`, (_, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.get("/", (_, res) => {
  res.redirect(`${BASE_PATH}/`);
});

app.get(`${BASE_PATH}/admin`, auth, (_, res) => {
  res.sendFile(path.join(ROOT, "public", "admin.html"));
});

app.get([BASE_PATH, `${BASE_PATH}/`, `${BASE_PATH}/*`], (req, res) => {
  if (req.path.startsWith(`${BASE_PATH}/api/`)) {
    return res.status(404).json({ message: "API Not Found" });
  }
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
