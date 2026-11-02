const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = {
  memoryGB: 4,
  // Pack shown when the launcher opens.
  lastPack: null,
};

class Settings {
  constructor(file) {
    this.file = file;
    this.values = { ...DEFAULTS };
    try {
      Object.assign(this.values, JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      // First run or unreadable file: keep defaults.
    }
  }

  get(key) {
    return this.values[key];
  }

  all() {
    return { ...this.values };
  }

  set(patch) {
    Object.assign(this.values, patch);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
    return this.all();
  }
}

module.exports = { Settings, DEFAULTS };
