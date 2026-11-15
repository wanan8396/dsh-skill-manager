window.__ModuleLoader__.load({
  id: '@local/skill-manager',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    const API = '/plugins/skill-manager'
    const NS = 'skillManager'
    const PANEL_ID = 'skill-manager'
    const STYLE_ID = 'dsm-skill-manager-style'

    const zh = {
      'panel.title': '技能管理',
      'panel.subtitle': '本机 SKILL.md：安装、导入、删除',
      'panel.refresh': '刷新',
      'list.loading': '正在读取技能…',
      'list.empty': '还没有发现本机技能',
      'list.emptyHint': '点下面的按钮选一个技能压缩包，选完就装好。',
      'list.count': '共 {count} 个技能',
      'root.project-dsh': '项目 .dsh',
      'root.project-agents': '项目 .agents',
      'root.user-dsh': '用户 ~/.dsh',
      'root.user-agents': '用户 ~/.agents',
      'row.delete': '删除',
      'row.confirm': '确认删除',
      'row.deleting': '删除中…',
      'row.cancel': '取消',
      'row.readonly': '只读',
      'row.directory': '目录',
      'row.file': '单文件',
      'row.nodesc': '（frontmatter 没有 description）',
      'install.hint': '压缩包（zip / tar.gz / tgz）或 SKILL.md 都行，选完自动安装，重名直接覆盖。',
      'pick.one': '选择技能压缩包 / SKILL.md',
      'pick.running': '安装中…',
      'notice.installed': '已安装 {name}',
      'notice.imported': '已导入 {name}',
      'notice.uploaded': '已从所选文件安装 {name}',
      'notice.deleted': '已删除 {name}',
      'notice.watch': '技能目录由文件系统提供者监视；新技能在下一个会话或下一步工具调用进入模型目录。',
      'notice.problems': '{count} 个条目被跳过（frontmatter 无效）',
      'error.prefix': '操作失败：',
      'write.to': '写入目录：',
    }

    const en = {
      'panel.title': 'Skills',
      'panel.subtitle': 'Local SKILL.md files: install, import, delete',
      'panel.refresh': 'Refresh',
      'list.loading': 'Reading skills…',
      'list.empty': 'No local skills found yet',
      'list.emptyHint': 'Tap the button below, pick a skill archive, done.',
      'list.count': '{count} skills',
      'root.project-dsh': 'Project .dsh',
      'root.project-agents': 'Project .agents',
      'root.user-dsh': 'User ~/.dsh',
      'root.user-agents': 'User ~/.agents',
      'row.delete': 'Delete',
      'row.confirm': 'Confirm delete',
      'row.deleting': 'Deleting…',
      'row.cancel': 'Cancel',
      'row.readonly': 'Read-only',
      'row.directory': 'Directory',
      'row.file': 'Single file',
      'row.nodesc': '(no description in frontmatter)',
      'install.toggle': 'Install skill',
      'install.title': 'Install skill',
      'install.hint': 'Pick one archive (zip / tar.gz / tgz) or a SKILL.md and it installs itself; the archive must contain SKILL.md.',
      'install.placeholder': '---\nname: my-skill\ndescription: When this skill should be used\n---\n\n# Body\nInstructions…',
      'install.mode': 'Layout',
      'install.modeDirectory': 'Directory name/SKILL.md',
      'install.modeFile': 'Single file name.md',
      'install.run': 'Install',
      'install.running': 'Installing…',
      'pick.one': 'Pick a skill archive / SKILL.md',
      'pick.running': 'Installing…',
      'notice.installed': 'Installed {name}',
      'notice.imported': 'Imported {name}',
      'notice.uploaded': 'Installed {name} from the chosen files',
      'notice.deleted': 'Deleted {name}',
      'notice.watch': 'The skill roots are watched; a new skill enters the catalog on the next session or the next tool step.',
      'notice.problems': '{count} entries skipped (invalid frontmatter)',
      'error.prefix': 'Failed: ',
      'write.to': 'Destination: ',
    }

    // ---------------------------------------------------------------- store

    const state = {
      loading: false,
      data: null,
      error: '',
      notice: '',
      installOpen: false,
      busy: '',
      confirmPath: '',
    }

    const listeners = new Set()
    const emit = () => {
      for (const listener of Array.from(listeners)) listener()
    }
    const patch = (next) => {
      Object.assign(state, next)
      emit()
    }

    function useStore() {
      const [, force] = React.useReducer((value) => value + 1, 0)
      React.useEffect(() => {
        listeners.add(force)
        return () => {
          listeners.delete(force)
        }
      }, [])
      return state
    }

    // ------------------------------------------------------------------ api

    async function request(route, body) {
      const response = await fetch(API + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const text = await response.text()
      let payload = null
      try {
        payload = text === '' ? null : JSON.parse(text)
      } catch {
        payload = null
      }
      if (!response.ok || (payload !== null && payload.ok === false)) {
        throw new Error(payload !== null && payload.error ? payload.error : 'HTTP ' + response.status)
      }
      return payload === null ? {} : payload
    }

    const message = (t, error) => t('error.prefix') + (error && error.message ? error.message : String(error))

    async function load(t) {
      patch({ loading: true, error: '' })
      try {
        const data = await request('/list')
        patch({ loading: false, data })
      } catch (error) {
        patch({ loading: false, error: message(t, error) })
      }
    }

    function readBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : ''
          const comma = result.indexOf(',')
          resolve(comma === -1 ? '' : result.slice(comma + 1))
        }
        reader.readAsDataURL(file)
      })
    }

    async function uploadFiles(t, fileList) {
      const picked = Array.from(fileList || [])
      if (picked.length === 0) return
      patch({ busy: 'upload', error: '', notice: '' })
      try {
        const files = []
        for (const file of picked) {
          const relative = file.webkitRelativePath && file.webkitRelativePath !== '' ? file.webkitRelativePath : file.name
          files.push({ path: relative, dataBase64: await readBase64(file) })
        }
        const result = await request('/install-upload', { files, overwrite: true })
        patch({ busy: '', installOpen: false, notice: t('notice.uploaded').replace('{name}', result.name) })
        await load(t)
      } catch (error) {
        patch({ busy: '', error: message(t, error) })
      }
    }

    async function removeSkill(t, skill) {
      patch({ busy: skill.path, error: '', notice: '' })
      try {
        const result = await request('/delete', { path: skill.path })
        patch({ busy: '', confirmPath: '', notice: t('notice.deleted').replace('{name}', result.name) })
        await load(t)
      } catch (error) {
        patch({ busy: '', error: message(t, error) })
      }
    }

    // ------------------------------------------------------------- artwork

    function Glyph(props) {
      const size = (props && props.size) || 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M6.1 2.4 7.2 5 9.8 6.1 7.2 7.2 6.1 9.8 5 7.2 2.4 6.1 5 5Z',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M11.6 8.3 12.3 10 10.6 10.7 12.3 11.4 13 13.1 13.7 11.4 15.4 10.7 13.7 10Z',
          fill: 'currentColor',
          opacity: 0.75,
        }),
      )
    }

    /** The sidebar panel-list row: the shell draws the button, label and state. */
    function PanelIcon(props) {
      const size = (props && props.size) || 18
      return h(Glyph, { size })
    }

    // ---------------------------------------------------------------- rows

    function SkillRow(props) {
      const skill = props.skill
      const t = props.t
      const current = useStore()
      const confirming = current.confirmPath === skill.path
      const busy = current.busy === skill.path
      let actions
      if (skill.writable !== true) {
        actions = h('span', { className: 'dsm-readonly' }, t('row.readonly'))
      } else if (confirming) {
        actions = h(
          'div',
          { className: 'dsm-row-actions' },
          h(
            'button',
            { type: 'button', className: 'dsm-btn dsm-danger', disabled: busy, onClick: () => void removeSkill(t, skill) },
            busy ? t('row.deleting') : t('row.confirm'),
          ),
          h('button', { type: 'button', className: 'dsm-btn', onClick: () => patch({ confirmPath: '' }) }, t('row.cancel')),
        )
      } else {
        actions = h(
          'div',
          { className: 'dsm-row-actions' },
          h('button', { type: 'button', className: 'dsm-btn', onClick: () => patch({ confirmPath: skill.path }) }, t('row.delete')),
        )
      }
      return h(
        'div',
        { className: 'dsm-row' },
        h(
          'div',
          { className: 'dsm-row-main' },
          h(
            'div',
            { className: 'dsm-row-title' },
            h('span', { className: 'dsm-name' }, skill.name),
            h('span', { className: 'dsm-tag' }, skill.kind === 'file' ? t('row.file') : t('row.directory')),
          ),
          h('div', { className: 'dsm-desc' }, skill.description === '' ? t('row.nodesc') : skill.description),
          h('div', { className: 'dsm-path' }, skill.path),
        ),
        actions,
      )
    }

    // ------------------------------------------------------------- pickers

    function Picker(props) {
      const t = props.t
      const current = useStore()
      const fileRef = React.useRef(null)
      const busy = current.busy === 'upload'

      return h(
        'div',
        { className: 'dsm-upload' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsm-btn dsm-primary dsm-wide',
            disabled: busy,
            onClick: () => fileRef.current && fileRef.current.click(),
          },
          busy ? t('pick.running') : t('pick.one'),
        ),
        h('input', {
          ref: fileRef,
          type: 'file',
          accept: '.zip,.tar,.gz,.tgz,.bz2,.xz,.md,.markdown',
          multiple: false,
          className: 'dsm-hidden',
          onChange: (event) => {
            const files = event.currentTarget.files
            event.currentTarget.value = ''
            void uploadFiles(t, files)
          },
        }),
      )
    }

    function Installer(props) {
      const t = props.t
      return h(
        'section',
        { className: 'dsm-card dsm-install' },
        h(Picker, { t }),
        h('p', { className: 'dsm-hint' }, t('install.hint')),
      )
    }

    // ----------------------------------------------------------------- page

    function SkillManagerPage(props) {
      const t = props.t
      const current = useStore()

      React.useEffect(() => {
        void load(t)
      }, [])

      const data = current.data
      const skills = data === null ? [] : data.skills
      const roots = data === null ? [] : data.roots

      const body = []
      if (current.error !== '') body.push(h('div', { className: 'dsm-error', role: 'alert', key: 'err' }, current.error))
      if (current.notice !== '') body.push(h('div', { className: 'dsm-notice', role: 'status', key: 'notice' }, current.notice))
      if (current.loading && data === null) body.push(h('p', { className: 'dsm-hint', key: 'loading' }, t('list.loading')))
      if (data !== null && data.problems.length > 0) {
        body.push(
          h('p', { className: 'dsm-hint', key: 'problems' }, t('notice.problems').replace('{count}', String(data.problems.length))),
        )
      }

      if (data !== null && skills.length === 0) {
        body.push(
          h(
            'div',
            { className: 'dsm-empty', key: 'empty' },
            h('div', { className: 'dsm-empty-title' }, t('list.empty')),
            h('p', { className: 'dsm-hint' }, t('list.emptyHint')),
          ),
        )
      }

      for (const root of roots) {
        const group = skills.filter((skill) => skill.root === root.id)
        if (group.length === 0) continue
        body.push(
          h(
            'section',
            { className: 'dsm-group', key: root.id },
            h(
              'div',
              { className: 'dsm-group-head' },
              h('span', { className: 'dsm-group-name' }, t('root.' + root.id)),
              h('span', { className: 'dsm-group-path' }, root.path),
              h('span', { className: 'dsm-group-count' }, String(group.length)),
            ),
            group.map((skill) => h(SkillRow, { key: skill.path, skill, t })),
          ),
        )
      }

      body.push(h(Installer, { key: 'installer', t }))
      body.push(h('p', { className: 'dsm-hint', key: 'watch' }, t('notice.watch')))
      if (data !== null) {
        body.push(h('div', { className: 'dsm-path', key: 'dest' }, t('write.to') + data.writableRoot))
      }

      return h(
        'div',
        { className: 'dsm-page' },
        h(
          'header',
          { className: 'dsm-head' },
          h('span', { className: 'dsm-glyph' }, h(Glyph, { size: 20 })),
          h(
            'div',
            { className: 'dsm-head-title' },
            h('h1', null, t('panel.title')),
            h('p', null, data === null ? t('panel.subtitle') : t('list.count').replace('{count}', String(data.total))),
          ),
          h('div', { className: 'dsm-grow' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dsm-btn',
              disabled: current.loading,
              onClick: () => void load(t),
              title: t('panel.refresh'),
            },
            t('panel.refresh'),
          ),
        ),
        h('div', { className: 'dsm-body' }, body),
      )
    }

    // ---------------------------------------------------------------- style

    const CSS = [
      '.dsm-page{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:20px 20px 40px;color:var(--dsw-alias-label-primary,#1f2328);font:inherit;line-height:1.55}',
      '.dsm-page *{box-sizing:border-box}',
      '.dsm-head{display:flex;align-items:center;gap:12px;min-width:0}',
      '.dsm-glyph{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.14));background:var(--dsw-alias-bg-layer-2,rgba(31,35,40,.04));color:var(--dsw-alias-state-business-primary,#247bbf);flex:none}',
      '.dsm-head-title{min-width:0}',
      '.dsm-head-title h1{margin:0;font-size:1.15em;font-weight:600;letter-spacing:.01em}',
      '.dsm-head-title p{margin:2px 0 0;font-size:.86em;color:var(--dsw-alias-label-tertiary,#6e7781)}',
      '.dsm-grow{flex:1 1 auto;min-width:0}',
      '.dsm-body{display:flex;flex-direction:column;gap:14px;padding-top:18px;min-width:0}',
      '.dsm-group{display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.dsm-group-head{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:.82em}',
      '.dsm-group-name{font-weight:600;color:var(--dsw-alias-label-secondary,#57606a);flex:none}',
      '.dsm-group-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary,#6e7781);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsm-group-count{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary,#6e7781)}',
      '.dsm-row{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.12));border-radius:12px;padding:11px 13px;background:var(--dsw-alias-bg-layer-1,transparent)}',
      '.dsm-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.dsm-row-title{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dsm-name{font-weight:600;font-size:.98em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsm-tag{flex:none;font-size:.72em;font-weight:600;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.16));color:var(--dsw-alias-label-tertiary,#6e7781)}',
      '.dsm-desc{font-size:.9em;line-height:1.55;color:var(--dsw-alias-label-secondary,#57606a);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}',
      '.dsm-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76em;line-height:1.5;color:var(--dsw-alias-label-tertiary,#6e7781);word-break:break-all}',
      '.dsm-row-actions{display:flex;flex-direction:column;gap:6px;flex:none}',
      '.dsm-row-inline{flex-direction:row;align-items:center;flex-wrap:wrap}',
      '.dsm-readonly{flex:none;font-size:.82em;color:var(--dsw-alias-label-tertiary,#6e7781)}',
      '.dsm-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.16));background:transparent;color:inherit;border-radius:8px;padding:6px 11px;font:inherit;font-size:.88em;line-height:1.4;cursor:pointer;white-space:nowrap;text-align:center}',
      '.dsm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,40,.06))}',
      '.dsm-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#247bbf);outline-offset:1px}',
      '.dsm-btn.dsm-tiny{padding:3px 8px;font-size:.8em}',
      '.dsm-btn.dsm-on{border-color:var(--dsw-alias-state-business-primary,#247bbf);color:var(--dsw-alias-state-business-primary,#247bbf)}',
      '.dsm-btn.dsm-primary{background:var(--dsw-alias-state-business-primary,#247bbf);border-color:transparent;color:#fff;font-weight:600}',
      '.dsm-btn.dsm-danger{border-color:var(--dsw-alias-state-error-primary,#cf222e);color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.dsm-card{display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.12));border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1,transparent);min-width:0}',
      '.dsm-card-title{margin:0;font-size:.95em;font-weight:600}',
      '.dsm-upload{display:flex;flex-direction:column;gap:8px}',
      '.dsm-install{gap:8px}',
      '.dsm-hidden{display:none}',
      '.dsm-folders{display:flex;flex-direction:column;gap:2px;max-height:240px;overflow:auto}',
      '.dsm-folder:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,40,.07))}',
      '.dsm-error{border:1px solid var(--dsw-alias-state-error-primary,#cf222e);color:var(--dsw-alias-state-error-primary,#cf222e);border-radius:10px;padding:9px 12px;font-size:.86em;line-height:1.55;white-space:pre-wrap}',
      '.dsm-notice{border:1px solid var(--dsw-alias-state-success-primary,#2da44e);color:var(--dsw-alias-state-success-primary,#2da44e);border-radius:10px;padding:9px 12px;font-size:.86em;line-height:1.55}',
      '.dsm-hint{margin:0;font-size:.82em;line-height:1.65;color:var(--dsw-alias-label-tertiary,#6e7781)}',
      '.dsm-empty{display:flex;flex-direction:column;gap:5px;padding:18px;border:1px dashed var(--dsw-alias-border-l1,rgba(31,35,40,.2));border-radius:12px}',
      '.dsm-empty-title{font-size:.98em;font-weight:600}',
    ].join('\n')

    function injectStyle() {
      if (typeof document === 'undefined') return () => {}
      if (document.getElementById(STYLE_ID) !== null) return () => {}
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = CSS
      document.head.appendChild(element)
      return () => {
        element.remove()
      }
    }

    // ---------------------------------------------------------------- apply

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skill-manager: locale')
      const t = ctx.locale.bind(NS)

      ctx.effect(() => injectStyle(), 'skill-manager: styles')

      // The sidebar's global panel list row, beside Plugins / Schedules / MCP.
      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 15,
                locale: NS,
                label: () => t('panel.title'),
              },
              PanelIcon,
            ),
          ),
        'skill-manager: sidebar row',
      )

      // The page that row selects in the main column.
      ctx.effect(
        () =>
          ctx.slots.inject('main', () =>
            ctx.slots.register(
              {
                name: 'main',
                key: PANEL_ID,
                locale: NS,
                inject: () => ({ t }),
              },
              SkillManagerPage,
            ),
          ),
        'skill-manager: main page',
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
