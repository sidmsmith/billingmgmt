const express = require("express");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");

const app = express();
app.use(express.json({ limit: "10mb" }));

const STATIC_ASSETS = ["shared.css", "app.js", "config-ui.js", "config-admin.js"];
STATIC_ASSETS.forEach((file) => {
  app.get("/" + file, (req, res, next) => {
    const publicPath = path.join(__dirname, "public", file);
    if (fs.existsSync(publicPath)) {
      return res.sendFile(publicPath);
    }
    next();
  });
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/config", express.static(path.join(__dirname, "config")));
app.use("/data", express.static(path.join(__dirname, "data")));

app.post("/api/:action", async (req, res) => {
  const url = process.env.VERCEL
    ? `https://${process.env.VERCEL_URL}/api/${req.params.action}`
    : "http://localhost:5000/api/" + req.params.action;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return res.status(response.status).json({
        success: false,
        error: text.slice(0, 200) || `Request failed (HTTP ${response.status})`,
      });
    }
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Billingmgmt on port ${PORT}`));
}

module.exports = app;
