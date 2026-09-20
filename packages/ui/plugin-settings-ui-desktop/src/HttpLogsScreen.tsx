/**
 * Desktop HTTP Logs Screen for `@BBeBee/plugin-settings-ui-desktop`.
 * Dedicated log viewer for outgoing third-party music source HTTP requests.
 */

import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { UiService, LogRecord } from '@BBeBee/protocol'
import { Button } from '@BBeBee/ui-kit-desktop'

interface LogBufferService {
  all: readonly LogRecord[]
  clear(): void
}

interface ParsedHttpLog {
  sn: number
  time: number
  method: string
  url: string
  status: number
  durationMs?: number
  raw: string
  isError: boolean
}

const HTTP_REGEX = /\[HTTP\]\s+([A-Z]+)\s+(.+?)\s+->\s+(\d+)\s+\((\d+)ms\)/

export function HttpLogsScreen({ ctx }: { ctx: Context }): ReactElement {
  const ui = serviceOf<UiService>(ctx, 'ui')
  const [records, setRecords] = useState<readonly LogRecord[]>([])
  const [statusFilter, setStatusFilter] = useState<'all' | '2xx' | '3xx' | 'error'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  // Poll log buffer every 1000ms
  useEffect(() => {
    const fetchLogs = () => {
      const buffer = serviceOf<LogBufferService>(ctx, 'logBuffer')
      if (buffer) {
        setRecords([...buffer.all])
      }
    }

    fetchLogs()
    const timer = setInterval(fetchLogs, 1000)
    return () => clearInterval(timer)
  }, [ctx])

  // Parse HTTP logs
  const httpLogs = useMemo<ParsedHttpLog[]>(() => {
    const out: ParsedHttpLog[] = []
    for (const rec of records) {
      const match = HTTP_REGEX.exec(rec.message)
      if (match) {
        const [, method, url, statusStr, durationStr] = match
        const status = parseInt(statusStr ?? '0', 10)
        out.push({
          sn: rec.sn,
          time: rec.time,
          method: method ?? 'GET',
          url: url ?? '',
          status,
          durationMs: parseInt(durationStr ?? '0', 10),
          raw: rec.message,
          isError: status >= 400 || rec.level === 'error',
        })
      } else if (
        rec.scope === 'source-runtime' ||
        rec.scope === 'http' ||
        rec.message.toLowerCase().includes('http') ||
        rec.message.includes('source-runtime')
      ) {
        out.push({
          sn: rec.sn,
          time: rec.time,
          method: rec.scope.toUpperCase(),
          url: rec.message,
          status: rec.level === 'error' ? 500 : rec.level === 'warn' ? 400 : 200,
          raw: rec.message,
          isError: rec.level === 'error' || rec.level === 'warn',
        })
      }
    }
    return out.reverse() // Newest first
  }, [records])

  const filtered = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    return httpLogs.filter((item) => {
      if (statusFilter === '2xx' && (item.status < 200 || item.status >= 300)) return false
      if (statusFilter === '3xx' && (item.status < 300 || item.status >= 400)) return false
      if (statusFilter === 'error' && item.status < 400 && !item.isError) return false

      if (search) {
        return item.url.toLowerCase().includes(search) || item.method.toLowerCase().includes(search)
      }
      return true
    })
  }, [httpLogs, statusFilter, searchTerm])

  const handleClear = () => {
    const buffer = serviceOf<LogBufferService>(ctx, 'logBuffer')
    buffer?.clear?.()
    setRecords([])
  }

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: '#0B0C10',
        color: '#E2E8F0',
        padding: '24px 32px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      },
    },
    // Top Bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexShrink: 0,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        h(Button, {
          variant: 'secondary',
          children: '← 返回调试',
          onPress: () => ui?.navigate?.('debug.view'),
        }),
        h(
          'div',
          null,
          h(
            'h1',
            {
              style: {
                fontSize: 20,
                fontWeight: 700,
                margin: 0,
                color: '#F8FAFC',
              },
            },
            '第三方源 HTTP 日志 (HTTP Logs)',
          ),
          h(
            'span',
            { style: { fontSize: 12, color: '#64748B' } },
            `监控第三方音乐源发起的 HTTP 请求与响应，共捕获 ${httpLogs.length} 条网络记录`,
          ),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 10 } },
        h(Button, {
          variant: 'danger',
          children: '清空日志',
          onPress: handleClear,
        }),
      ),
    ),

    // Filters
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 16,
          flexShrink: 0,
          background: 'rgba(255, 255, 255, 0.03)',
          padding: '10px 16px',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.05)',
        },
      },
      // Search input
      h('input', {
        type: 'text',
        placeholder: '过滤目标 URL、域名或请求路径…',
        value: searchTerm,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value),
        style: {
          flex: 1,
          background: 'rgba(0, 0, 0, 0.3)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 6,
          padding: '6px 12px',
          color: '#F8FAFC',
          fontSize: 13,
          outline: 'none',
        },
      }),
      // Status Filter Pills
      h(
        'div',
        { style: { display: 'flex', gap: 6 } },
        renderFilterBtn('all', '全部', statusFilter, setStatusFilter),
        renderFilterBtn('2xx', '2xx 成功', statusFilter, setStatusFilter),
        renderFilterBtn('3xx', '3xx 重定向', statusFilter, setStatusFilter),
        renderFilterBtn('error', '异常 / 4xx / 5xx', statusFilter, setStatusFilter),
      ),
    ),

    // HTTP Requests Table / List
    h(
      'div',
      {
        style: {
          flex: 1,
          overflowY: 'auto',
          background: '#060709',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
          fontSize: 12,
        },
      },
      filtered.length === 0
        ? h(
            'div',
            {
              style: {
                padding: '40px',
                textAlign: 'center',
                color: '#64748B',
                fontSize: 13,
              },
            },
            '暂无第三方源发起的 HTTP 请求记录',
          )
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column' } },
            // Table Header
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 16px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#94A3B8',
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                },
              },
              h('span', { style: { width: 100 } }, '时间'),
              h('span', { style: { width: 64 } }, '方法'),
              h('span', { style: { width: 64 } }, '状态码'),
              h('span', { style: { width: 80 } }, '耗时'),
              h('span', { style: { flex: 1 } }, '请求地址 (URL) / 详情'),
            ),
            // Table Rows
            filtered.map((item) => renderHttpRow(item)),
          ),
    ),
  )
}

function renderFilterBtn(
  val: 'all' | '2xx' | '3xx' | 'error',
  label: string,
  current: 'all' | '2xx' | '3xx' | 'error',
  onChange: (val: 'all' | '2xx' | '3xx' | 'error') => void,
): ReactElement {
  const active = current === val
  return h(
    'button',
    {
      key: val,
      type: 'button',
      onClick: () => onChange(val),
      style: {
        background: active ? '#7C3AED' : 'rgba(255, 255, 255, 0.05)',
        color: active ? '#FFFFFF' : '#94A3B8',
        border: 'none',
        padding: '5px 12px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      },
    },
    label,
  )
}

function renderHttpRow(item: ParsedHttpLog): ReactElement {
  const timeStr = new Date(item.time).toTimeString().split(' ')[0] + '.' + String(item.time % 1000).padStart(3, '0')

  const statusColor =
    item.status >= 200 && item.status < 300
      ? '#4ADE80'
      : item.status >= 300 && item.status < 400
        ? '#FACC15'
        : '#F87171'

  const methodColor =
    item.method === 'GET'
      ? '#38BDF8'
      : item.method === 'POST'
        ? '#A78BFA'
        : item.method === 'HEAD'
          ? '#F472B6'
          : '#94A3B8'

  return h(
    'div',
    {
      key: `${item.sn}-${item.time}`,
      style: {
        display: 'flex',
        alignItems: 'center',
        padding: '8px 16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.02)',
        lineHeight: 1.4,
      },
    },
    h('span', { style: { width: 100, color: '#64748B', flexShrink: 0 } }, timeStr),
    h(
      'span',
      {
        style: {
          width: 64,
          color: methodColor,
          fontWeight: 700,
          fontSize: 11,
          flexShrink: 0,
        },
      },
      item.method,
    ),
    h(
      'span',
      {
        style: {
          width: 64,
          color: statusColor,
          fontWeight: 700,
          fontSize: 11,
          flexShrink: 0,
        },
      },
      item.status ? String(item.status) : 'ERR',
    ),
    h(
      'span',
      { style: { width: 80, color: '#94A3B8', fontSize: 11, flexShrink: 0 } },
      item.durationMs !== undefined ? `${item.durationMs}ms` : '-',
    ),
    h(
      'span',
      {
        style: {
          flex: 1,
          color: '#F8FAFC',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
        title: item.url,
      },
      item.url,
    ),
  )
}
