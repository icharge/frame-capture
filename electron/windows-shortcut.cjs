const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");

class WindowsShortcut {
  constructor({
    executable,
    preferenceFile,
    onCapture,
    onChange,
    defaultEnabled = true,
  }) {
    Object.assign(this, {
      executable,
      preferenceFile,
      onCapture,
      onChange,
      defaultEnabled,
    });
    this.status = { enabled: false, active: false, error: "" };
    this.child = null;
    this.queue = Promise.resolve();
  }
  async init() {
    let enabled = this.defaultEnabled;
    try {
      const saved = JSON.parse(await fs.readFile(this.preferenceFile, "utf8"));
      enabled = saved.enabled === true;
    } catch (error) {
      if (error.code !== "ENOENT") enabled = false;
    }
    await this.apply(enabled);
    return this.status;
  }
  setEnabled(enabled) {
    if (typeof enabled !== "boolean")
      return Promise.reject(
        new Error("Choose whether Win+Shift+S is enabled."),
      );
    const change = this.queue.then(async () => {
      const previous = this.status.enabled;
      const status = await this.apply(enabled);
      try {
        await fs.writeFile(
          this.preferenceFile + ".tmp",
          JSON.stringify({ enabled }),
        );
        await fs.rename(this.preferenceFile + ".tmp", this.preferenceFile);
      } catch (error) {
        await this.apply(previous);
        throw error;
      }
      return { ...status };
    });
    this.queue = change.catch(() => {});
    return change;
  }
  changed() {
    this.onChange?.({ ...this.status });
  }
  async apply(enabled) {
    if (!enabled) {
      await this.stop();
      this.status = { enabled: false, active: false, error: "" };
      this.changed();
      return this.status;
    }
    if (this.child && this.status.active) return this.status;
    this.status = { enabled: true, active: false, error: "" };
    await new Promise((resolve) => {
      const child = spawn(this.executable, [String(process.pid)], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
      this.child = child;
      let pending = "",
        settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };
      const fail = () => {
        if (this.child !== child) return finish();
        this.child = null;
        this.status = {
          enabled: true,
          active: false,
          error:
            "Win+Shift+S could not be enabled. Ctrl+Shift+2 is still available.",
        };
        this.changed();
        finish();
      };
      const timer = setTimeout(() => {
        child.kill();
        fail();
      }, 5000);
      child.stdin.on("error", () => {});
      child.on("error", fail);
      child.on("exit", fail);
      child.stdout.on("data", (chunk) => {
        pending += chunk.toString();
        if (pending.length > 1024) {
          child.kill();
          return fail();
        }
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (this.child !== child) return;
          if (line === "READY") {
            this.status = { enabled: true, active: true, error: "" };
            this.changed();
            finish();
          } else if (line === "CAPTURE" && this.status.active) this.onCapture();
          else if (line === "ERROR") {
            child.kill();
            fail();
          }
        }
      });
    });
    return this.status;
  }
  async stop() {
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null)
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 1000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end();
      });
  }
  dispose() {
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}
module.exports = { WindowsShortcut };
