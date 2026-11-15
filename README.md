# DSH Skill Manager

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that adds a
**技能管理 / Skills** row to the left sidebar's global entry list — the block that holds
插件, 自动化任务 and MCP 连接. Selecting the row opens a manager page in the main column where you
can install, import and delete local `SKILL.md` skills without leaving the app.

[中文说明](#中文说明)

## Features

- **Lists every local skill**, grouped by root:
  `<project>/.dsh/skills`, `<project>/.agents/skills`, `~/.dsh/skills`, `~/.agents/skills`.
- **Install from the system file picker** — `选择文件…` opens the browser's file chooser
  (`.md`, multi-select) and uploads the exact bytes.
- **Install a whole skill folder** — `选择技能文件夹…` uses `webkitdirectory`, so `SKILL.md`
  plus `references/`, `scripts/` and `assets/` land together.
- **Browse the Host filesystem in-app** — `浏览服务器目录…` drives
  `uiWorkspace.listDirectory` with breadcrumbs, so `/sdcard/Download` is two taps away on
  Android and any absolute path works on desktop.
- **System folder picker** — `系统目录选择器` calls `uiWorkspace.pickDirectory()` and falls back
  to the in-app browser when the Host composed the browse backend instead of an OS chooser.
- **Paste to install** — a `SKILL.md` body with `---` frontmatter, written as a directory
  (`name/SKILL.md`) or a flat file (`name.md`).
- **Delete with confirmation** — `删除 → 确认删除`; project roots are listed read-only.
- Bilingual UI copy (zh / en) through the DSH client locale service.

## Install

The plugin is a local DSH bundle: no build step, no dependencies.

```bash
git clone https://github.com/wanan8396/dsh-skill-manager.git
```

Then either:

1. **Plugins → Add plugin → local directory**, and pick the cloned folder, or
2. ask the agent / call `plugin_manager` with `action: install_bundle` and the absolute path
   of the cloned package.

Reload the web page once. The **技能管理** row appears in the sidebar between 自动化任务 and
MCP 连接; the plugin row can be toggled in **Plugins**.

## Usage

| Step | What to do |
| --- | --- |
| Open | Sidebar → **技能管理** |
| Refresh | **刷新** re-scans every root |
| Install | **＋ 安装技能** → choose a file, choose a folder, browse the Host, or paste a `SKILL.md` |
| Import | Pick an existing directory/`.md` on the Host and press **导入** |
| Delete | **删除** → **确认删除** (user root only) |

Installed skills are watched by `@deepseek-ai/dsh-skill-filesystem`, so a new skill enters the
model catalog on the next session or the next tool step; loading a skill always re-reads the file.

## Host API

The bundle inserts one Host row that serves JSON on the existing DSH web server:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/plugins/skill-manager/list` | discovered skills, roots and writability |
| `POST` | `/plugins/skill-manager/install` | write a pasted `SKILL.md` |
| `POST` | `/plugins/skill-manager/install-upload` | write files chosen in the browser (base64) |
| `POST` | `/plugins/skill-manager/import` | copy a local skill directory/`.md` |
| `POST` | `/plugins/skill-manager/delete` | remove one user skill |

Write scope is deliberately narrow:

- Only direct children of `~/.dsh/skills` are writable or deletable; project roots are read-only.
- Uploads are capped at 8 MB per request, 4 MB per file, 64 files, and every path must be
  relative, traversal-free and inside the skill directory.
- A directory without `SKILL.md` is never deleted, and `name` in the frontmatter must be
  kebab-case.

## Files

| File | Role |
| --- | --- |
| `host.js` | Host half: discovery, validation, the five JSON routes |
| `index.js` | Entry shim re-exporting `host.js` |
| `client.js` | Browser half: sidebar row, page, pickers, `window.__ModuleLoader__` factory |
| `cordis.patch.yml` | Bundle patch inserting the Host row |
| `locale/*.json` | Plugin manager title/description |

## Compatibility

Developed against DSH `0.2.2-rc.3` (Android phone shell and desktop web GUI). It uses the
`sidebar.panellist` + `main` slots, `ctx.locale`, `ctx.slots`, and `ctx.uiWorkspace`
(`listDirectory` / `pickDirectory`). Other DSH releases may rename those APIs.

## Limitations

- Discovery is one level deep, matching the filesystem provider.
- Skills with malformed frontmatter are skipped and reported as a count, not per skill.
- `选择技能文件夹…` depends on `webkitdirectory`; where the WebView ignores it, use
  **浏览服务器目录** instead.
- Disabling the plugin removes the sidebar row, the page and the routes; installed skills stay
  on disk.

## License

[MIT](LICENSE)

---

## 中文说明

给 DeepSeek Harness 用的技能管理插件：左侧边栏全局入口（插件、自动化任务同一块）多一行
**技能管理**，点开在中间栏打开管理页。

- 按技能根目录分组列出所有本机 `SKILL.md`（项目 `.dsh`/`.agents`、用户 `~/.dsh`/`~/.agents`）
- **选择文件…** 打开系统文件选择器（`.md`，可多选），或 **选择技能文件夹…** 整包上传
- **浏览服务器目录…** 用内置目录浏览（`uiWorkspace.listDirectory`）直接点到 `/sdcard/Download`
- **系统目录选择器** 在没有原生选择器时自动降级到内置浏览
- 也可粘贴 `SKILL.md` 安装，可选「目录/单文件」与覆盖同名
- 用户技能可删除（二次确认），项目技能只读
- 界面文案走 DSH 的 locale 服务，中英双语

安装：把仓库克隆到本机，在 **插件 → 添加插件** 里选这个目录（或让 agent 用
`plugin_manager` 的 `install_bundle` 指向该绝对路径），然后刷新页面。写入位置固定为
`~/.dsh/skills`，其余根目录只读。许可证 MIT。
