/**
 * Host half of @local/skill-manager.
 *
 * Owns one JSON API on the existing DSH web server:
 *
 *   GET  /plugins/skill-manager/list           – every discovered skill plus its root
 *   POST /plugins/skill-manager/install        – write a pasted SKILL.md into the user root
 *   POST /plugins/skill-manager/install-upload – write files chosen in the browser
 *   POST /plugins/skill-manager/install-from-path – copy a folder/.md the user just picked
 *   POST /plugins/skill-manager/delete         – remove one skill from the user root
 *
 * Discovery mirrors @deepseek-ai/dsh-skill-filesystem: `<root>/<name>/SKILL.md`
 * or `<root>/<name>.md`, one level deep, YAML frontmatter with `name` and
 * `description`. Only the user root (`<dshHome>/skills`) is writable here, so a
 * project checkout listed in the panel stays read-only.
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Stable cordis plugin name — must equal the package name. */
export const name = '@local/skill-manager'

/** The HTTP carrier is the only Host service this plugin needs. */
export const inject = ['webServer']

const BASE = '/plugins/skill-manager'
const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_FILES = 64
const MAX_FILE_BYTES = 4 * 1024 * 1024
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

class HttpError extends Error {
  constructor(status, message, code = 'E_REQUEST') {
    super(message)
    this.status = status
    this.code = code
  }
}

function report(message) {
  try {
    process.stderr.write(`@local/skill-manager: ${message}\n`)
  } catch {
    // The plugin may be loaded without a writable stderr; registration is
    // still observable through the routes below.
  }
}

function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return configured === '' ? path.join(os.homedir(), '.dsh') : configured
}

function agentsHome() {
  const configured = typeof process.env.DSH_AGENTS_HOME === 'string' ? process.env.DSH_AGENTS_HOME.trim() : ''
  return configured === '' ? path.join(os.homedir(), '.agents') : configured
}

/** The nearest ancestor carrying `.git`, else the process directory. */
function projectRoot(start) {
  const origin = path.resolve(start)
  let current = origin
  for (let depth = 0; depth < 64; depth += 1) {
    if (existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return origin
    current = parent
  }
  return origin
}

/**
 * Ranked skill roots, keeping the filesystem provider's order and labels so the
 * page explains where each skill came from.
 */
function roots() {
  const base = path.resolve(process.cwd())
  const home = path.resolve(os.homedir())
  // The harness process may run from the home directory; scanning the home as a
  // project would duplicate the user roots and hide their writability.
  const project = base === home ? null : projectRoot(base)
  const candidates = []
  if (project !== null) {
    candidates.push({ id: 'project-dsh', path: path.join(project, '.dsh', 'skills') })
    candidates.push({ id: 'project-agents', path: path.join(project, '.agents', 'skills') })
  }
  candidates.push({ id: 'user-dsh', path: path.join(dshHome(), 'skills'), writable: true })
  candidates.push({ id: 'user-agents', path: path.join(agentsHome(), 'skills') })

  const byPath = new Map()
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate.path)
    const seen = byPath.get(resolved)
    if (seen !== undefined) {
      if (candidate.writable === true) seen.writable = true
      continue
    }
    byPath.set(resolved, {
      id: candidate.id,
      path: resolved,
      writable: candidate.writable === true,
      exists: existsSync(resolved),
    })
  }
  return Array.from(byPath.values())
}

/** Read one YAML frontmatter block as a flat key → string map. */
function frontmatter(text) {
  const body = text.replace(/^\uFEFF/, '')
  if (!body.startsWith('---')) return null
  const end = body.indexOf('\n---', 3)
  if (end === -1) return null
  const lines = body.slice(3, end).split(/\r?\n/)
  const fields = new Map()
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[index])
    if (match === null) continue
    const key = match[1]
    let value = match[2].trim()
    if (/^[>|][+-]?$/.test(value)) {
      const collected = []
      let cursor = index + 1
      while (cursor < lines.length) {
        const line = lines[cursor]
        if (line.trim() === '') {
          collected.push('')
          cursor += 1
          continue
        }
        if (!/^\s+/.test(line)) break
        collected.push(line.trim())
        cursor += 1
      }
      index = cursor - 1
      value = collected.join(value.startsWith('|') ? '\n' : ' ').trim()
    } else if (/^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1)
    }
    fields.set(key, value)
  }
  return fields
}

function parseSkill(text) {
  const fields = frontmatter(text)
  if (fields === null) {
    throw new HttpError(400, 'SKILL.md 需要以 --- 开头的 YAML frontmatter', 'E_FRONTMATTER')
  }
  const skillName = (fields.get('name') || '').trim()
  const description = (fields.get('description') || '').trim()
  if (!NAME_PATTERN.test(skillName)) {
    throw new HttpError(400, 'frontmatter 的 name 必须是 kebab-case，例如 my-skill', 'E_NAME')
  }
  if (description === '') {
    throw new HttpError(400, 'frontmatter 缺少 description', 'E_DESCRIPTION')
  }
  return { skillName, description }
}

function skillNameFromFileName(file) {
  return path.basename(file, '.md')
}

async function readSkillFile(file, kind, fallbackName) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    return { invalid: `无法读取 ${path.basename(file)}：${(error && error.message) || error}` }
  }
  const fields = frontmatter(text)
  if (fields === null) return { invalid: '缺少 YAML frontmatter' }
  const declared = (fields.get('name') || '').trim()
  const description = (fields.get('description') || '').trim()
  return {
    name: declared !== '' ? declared : fallbackName,
    description,
    kind,
  }
}

async function scanRoot(root) {
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true })
  } catch {
    return { skills: [], problems: [] }
  }
  const skills = []
  const problems = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    let target = null
    let kind = null
    if (entry.isDirectory() || (entry.isSymbolicLink() && existsSync(path.join(root.path, entry.name, 'SKILL.md')))) {
      target = path.join(root.path, entry.name, 'SKILL.md')
      kind = 'directory'
      if (!existsSync(target)) {
        // A directory without SKILL.md is not a skill bundle.
        continue
      }
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
      target = path.join(root.path, entry.name)
      kind = 'file'
    } else {
      continue
    }
    const fallbackName = kind === 'directory' ? entry.name : skillNameFromFileName(target)
    const parsed = await readSkillFile(target, kind, fallbackName)
    if (parsed.invalid !== undefined) {
      problems.push({ file: target, reason: parsed.invalid })
      continue
    }
    let modified = 0
    try {
      const info = await stat(target)
      modified = info.mtimeMs
    } catch {
      modified = 0
    }
    skills.push({
      name: parsed.name,
      description: parsed.description,
      kind,
      root: root.id,
      rootPath: root.path,
      writable: root.writable === true,
      path: kind === 'directory' ? path.dirname(target) : target,
      file: target,
      modified,
    })
  }
  return { skills, problems }
}

async function listSkills() {
  const rootList = roots()
  const skills = []
  const problems = []
  for (const root of rootList) {
    const scanned = await scanRoot(root)
    skills.push(...scanned.skills)
    problems.push(...scanned.problems)
  }
  skills.sort((left, right) => left.name.localeCompare(right.name))
  return {
    ok: true,
    home: dshHome(),
    roots: rootList,
    writableRoot: (rootList.find((root) => root.writable) || {}).path || '',
    skills,
    problems,
    total: skills.length,
  }
}

function writableRoots() {
  return roots().filter((root) => root.writable)
}

/** Resolve one skill path that lives directly under a writable root. */
function assertManageable(target) {
  const resolved = path.resolve(String(target || ''))
  if (resolved === '') throw new HttpError(400, '缺少 path', 'E_INPUT')
  const allowed = writableRoots()
  for (const root of allowed) {
    if (path.dirname(resolved) === path.resolve(root.path)) return { resolved, root }
  }
  throw new HttpError(403, '只能管理用户技能根目录下的直接子项', 'E_SCOPE')
}

function uniqueRoot() {
  const candidate = writableRoots()[0]
  if (candidate === undefined) {
    throw new HttpError(500, '没有可写的技能根目录', 'E_NO_ROOT')
  }
  return candidate
}

async function installSkill(input) {
  const content = typeof input.content === 'string' ? input.content : ''
  if (content.trim() === '') throw new HttpError(400, 'content 不能为空', 'E_INPUT')
  const parsed = parseSkill(content)
  const mode = input.mode === 'file' ? 'file' : 'directory'
  const root = uniqueRoot()
  await mkdir(root.path, { recursive: true })
  const target = mode === 'file'
    ? path.join(root.path, `${parsed.skillName}.md`)
    : path.join(root.path, parsed.skillName, 'SKILL.md')
  const occupied = existsSync(target)
  if (occupied && input.overwrite !== true) {
    throw new HttpError(409, `技能 ${parsed.skillName} 已存在（${target}）`, 'E_EXISTS')
  }
  if (mode === 'file') {
    await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
  } else {
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
  }
  return {
    ok: true,
    name: parsed.skillName,
    description: parsed.description,
    mode,
    path: target,
    overwritten: occupied,
  }
}

/** One uploaded file's workspace-relative path, refusing traversal and absolutes. */
function safeRelativePath(raw) {
  const value = String(raw || '').replace(/\\/g, '/').trim()
  if (value === '') throw new HttpError(400, '上传文件缺少路径', 'E_INPUT')
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new HttpError(400, `上传路径必须是相对路径：${value}`, 'E_PATH')
  }
  const normalized = path.posix.normalize(value)
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
    throw new HttpError(400, `上传路径越界：${value}`, 'E_PATH')
  }
  return normalized
}

function decodeUpload(file) {
  const text = typeof file.text === 'string' ? file.text : ''
  const base64 = typeof file.dataBase64 === 'string' ? file.dataBase64 : ''
  if (base64 !== '') {
    const buffer = Buffer.from(base64, 'base64')
    return { buffer, text: buffer.toString('utf8') }
  }
  const buffer = Buffer.from(text, 'utf8')
  return { buffer, text }
}

/**
 * Write files chosen in the browser: one skill directory when the browser sent
 * a folder (or a `SKILL.md`), otherwise one flat `<name>.md` skill.
 */
async function installUpload(input) {
  const raw = Array.isArray(input.files) ? input.files : []
  if (raw.length === 0) throw new HttpError(400, '没有收到文件', 'E_INPUT')
  if (raw.length > MAX_FILES) throw new HttpError(413, `一次最多 ${MAX_FILES} 个文件`, 'E_TOO_MANY')

  const files = []
  for (const file of raw) {
    const relative = safeRelativePath(file && file.path)
    const decoded = decodeUpload(file || {})
    if (decoded.buffer.length > MAX_FILE_BYTES) {
      throw new HttpError(413, `文件过大：${relative}`, 'E_TOO_LARGE')
    }
    files.push({ relative, buffer: decoded.buffer, text: decoded.text })
  }

  const nested = files.filter((file) => file.relative.includes('/'))
  const skillFile = files.find((file) => file.relative === 'SKILL.md' || file.relative.endsWith('/SKILL.md'))
  const root = uniqueRoot()
  await mkdir(root.path, { recursive: true })

  let mode
  let skillName
  let description
  let target

  if (nested.length > 0) {
    const tops = new Set(files.map((file) => file.relative.split('/')[0]))
    if (tops.size !== 1) {
      throw new HttpError(400, '一次只能导入一个技能文件夹', 'E_LAYOUT')
    }
    const top = Array.from(tops)[0]
    const manifest = files.find((file) => file.relative === `${top}/SKILL.md`)
    if (manifest === undefined) {
      throw new HttpError(400, `文件夹 ${top} 里没有 SKILL.md`, 'E_NOT_SKILL')
    }
    const parsed = parseSkill(manifest.text)
    skillName = parsed.skillName
    description = parsed.description
    mode = 'directory'
    target = path.join(root.path, skillName)
  } else if (skillFile !== undefined) {
    const parsed = parseSkill(skillFile.text)
    skillName = parsed.skillName
    description = parsed.description
    mode = 'directory'
    target = path.join(root.path, skillName)
  } else if (files.length === 1) {
    const parsed = parseSkill(files[0].text)
    skillName = parsed.skillName
    description = parsed.description
    mode = 'file'
    target = path.join(root.path, `${skillName}.md`)
  } else {
    throw new HttpError(400, '多个文件需要放在同一个技能文件夹里，并包含 SKILL.md', 'E_LAYOUT')
  }

  const occupied = existsSync(target)
  if (occupied && input.overwrite !== true) {
    throw new HttpError(409, `技能 ${skillName} 已存在（${target}）`, 'E_EXISTS')
  }
  if (occupied) await rm(target, { recursive: true, force: true })

  if (mode === 'file') {
    const buffer = files[0].buffer
    const text = buffer.toString('utf8')
    await writeFile(target, text.endsWith('\n') ? text : `${text}\n`)
  } else {
    await mkdir(target, { recursive: true })
    const prefix = files.find((file) => file.relative.includes('/'))
    const strip = prefix === undefined ? 0 : prefix.relative.split('/')[0].length + 1
    for (const file of files) {
      const relative = strip === 0 ? file.relative : file.relative.slice(strip)
      const destination = path.join(target, relative)
      const contained = path.resolve(destination)
      if (!contained.startsWith(`${path.resolve(target)}${path.sep}`)) {
        throw new HttpError(400, `上传路径越界：${file.relative}`, 'E_PATH')
      }
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, file.buffer)
    }
  }

  return { ok: true, name: skillName, description, mode, path: target, overwritten: occupied, files: files.length }
}

/**
 * Copy a skill the user picked in the file browser: one directory holding
 * SKILL.md, or one `.md` file. The path comes from a Host listing, never a
 * free-text field, and it is validated like every other write target.
 */
async function installFromPath(input) {
  const source = path.resolve(String(input.path || ''))
  if (source === '') throw new HttpError(400, '缺少 path', 'E_INPUT')
  let info
  try {
    info = await stat(source)
  } catch {
    throw new HttpError(404, `路径不存在：${source}`, 'E_MISSING')
  }
  const root = uniqueRoot()
  await mkdir(root.path, { recursive: true })

  let mode
  let skillFile
  if (info.isDirectory()) {
    skillFile = path.join(source, 'SKILL.md')
    mode = 'directory'
    if (!existsSync(skillFile)) throw new HttpError(400, '该文件夹里没有 SKILL.md', 'E_NOT_SKILL')
  } else if (info.isFile() && source.endsWith('.md')) {
    skillFile = source
    mode = 'file'
  } else {
    throw new HttpError(400, '只能选择技能文件夹或 .md 文件', 'E_INPUT')
  }

  const parsed = parseSkill(await readFile(skillFile, 'utf8'))
  const target = mode === 'file' ? path.join(root.path, `${parsed.skillName}.md`) : path.join(root.path, parsed.skillName)
  const occupied = existsSync(target)
  if (occupied) {
    if (input.overwrite !== true) throw new HttpError(409, `技能 ${parsed.skillName} 已存在（${target}）`, 'E_EXISTS')
    await rm(target, { recursive: true, force: true })
  }
  if (mode === 'file') await cp(source, target, { force: true })
  else await cp(source, target, { recursive: true, force: true })

  return { ok: true, name: parsed.skillName, description: parsed.description, mode, path: target, overwritten: occupied }
}

async function deleteSkill(input) {
  const { resolved } = assertManageable(input.path)
  let info
  try {
    info = await stat(resolved)
  } catch {
    throw new HttpError(404, `路径不存在：${resolved}`, 'E_MISSING')
  }
  if (info.isDirectory()) {
    if (!existsSync(path.join(resolved, 'SKILL.md'))) {
      throw new HttpError(400, '该目录不是技能包（缺少 SKILL.md），已拒绝删除', 'E_NOT_SKILL')
    }
  } else if (!resolved.endsWith('.md')) {
    throw new HttpError(400, '只能删除技能目录或 .md 文件', 'E_INPUT')
  }
  await rm(resolved, { recursive: true, force: true })
  return { ok: true, removed: resolved, name: path.basename(resolved, '.md') }
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '请求体超过 8 MB', 'E_TOO_LARGE')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON', 'E_JSON')
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  return site === undefined || site === 'same-origin' || site === 'same-site' || site === 'none'
}

function methodNotAllowed(res, method, allowed) {
  res.setHeader('allow', allowed)
  sendJson(res, 405, { ok: false, error: `不支持 ${method}，允许：${allowed}`, code: 'E_METHOD' })
}

const POST_ROUTES = new Set(['/install', '/install-upload', '/install-from-path', '/delete'])

async function dispatch(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const route = url.pathname.slice(BASE.length).replace(/\/+$/, '')
  const method = (req.method || 'GET').toUpperCase()

  if (route === '/list') {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(res, method, 'GET, HEAD')
    sendJson(res, 200, await listSkills())
    return
  }

  if (!POST_ROUTES.has(route)) {
    sendJson(res, 404, { ok: false, error: 'unknown endpoint', code: 'E_NOT_FOUND' })
    return
  }
  if (method !== 'POST') return methodNotAllowed(res, method, 'POST')
  if (!sameOrigin(req)) {
    sendJson(res, 403, { ok: false, error: '拒绝跨站请求', code: 'E_ORIGIN' })
    return
  }

  const body = await readJson(req)
  if (route === '/install') {
    sendJson(res, 200, await installSkill(body))
    return
  }
  if (route === '/install-upload') {
    sendJson(res, 200, await installUpload(body))
    return
  }
  if (route === '/install-from-path') {
    sendJson(res, 200, await installFromPath(body))
    return
  }
  sendJson(res, 200, await deleteSkill(body))
}

function handler(req, res) {
  dispatch(req, res).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500
    if (!(error instanceof HttpError)) report(`request failed: ${(error && error.stack) || error}`)
    if (res.headersSent) {
      res.end()
      return
    }
    sendJson(res, status, {
      ok: false,
      error: (error && error.message) || 'internal error',
      code: error instanceof HttpError ? error.code : 'E_INTERNAL',
    })
  })
}

/**
 * Register the JSON API on the Host web server.
 * @param ctx - the plugin's Cordis context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: BASE, handler }), 'skill-manager: routes')
  report(`routes ready at ${BASE}`)
}
