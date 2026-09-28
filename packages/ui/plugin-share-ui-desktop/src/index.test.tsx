// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { render } from '@testing-library/react'
import { Context, Service } from 'cordis'
import pluginShareUi from './index.js'
import { ShareCardPreview } from './components/ShareCardPreview.js'
import { ShareTrackModal } from './components/ShareTrackModal.js'
import { ShareLyricsModal } from './components/ShareLyricsModal.js'
import { ImportShareModal } from './components/ImportShareModal.js'

class UiStub extends Service {
  public views = new Map<string, any>()
  public contributions: any[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: any) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }

  contribute(contribution: any) {
    this.contributions.push(contribution)
    return () => {}
  }

  viewFor(id: string) {
    return this.views.get(id)
  }
}

class ShareStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'share')
  }
}

describe('plugin-share-ui-desktop', () => {
  it('registers share.host view in ctx.ui', async () => {
    const ctx = new Context()
    ctx.plugin(UiStub)
    ctx.plugin(ShareStub)
    await ctx.plugin(pluginShareUi)

    expect(ctx.ui.viewFor('share.host')).toBeDefined()
  })

  it('renders ShareCardPreview for track and lyrics', () => {
    const { container: trackContainer } = render(
      h(ShareCardPreview, {
        title: '七里香',
        subtitle: '周杰伦',
        themeColor: '#FF6B00',
        backgroundMode: 'gradient',
      }),
    )
    expect(trackContainer.textContent).toContain('七里香')
    expect(trackContainer.textContent).toContain('周杰伦')

    const { container: lyricsContainer } = render(
      h(ShareCardPreview, {
        title: '幸福不是情歌',
        subtitle: '刘若英',
        themeColor: '#79486D',
        backgroundMode: 'cover',
        lyrics: ['人生的挫折 好在有舍就有得', '曾真心付出的 都会是值得的'],
      }),
    )
    expect(lyricsContainer.textContent).toContain('幸福不是情歌')
    expect(lyricsContainer.textContent).toContain('人生的挫折 好在有舍就有得')
  })

  it('renders ShareTrackModal with background modes and action buttons', () => {
    const ctx = new Context()
    const { baseElement } = render(
      h(ShareTrackModal, {
        ctx,
        open: true,
        onClose: () => {},
        track: {
          urn: 'source:test:track:1',
          title: 'Best Is Yet To Come',
          artist: 'Sandro Cavazza',
        },
      }),
    )
    expect(baseElement.textContent).toContain('分享歌曲')
    expect(baseElement.textContent).toContain('背景调节')
    expect(baseElement.textContent).toContain('纯主题色')
    expect(baseElement.textContent).toContain('复制 Base64')
    expect(baseElement.textContent).toContain('下载图片')
  })

  it('renders ShareLyricsModal with lyric lines', () => {
    const ctx = new Context()
    const { baseElement } = render(
      h(ShareLyricsModal, {
        ctx,
        open: true,
        onClose: () => {},
        lyrics: {
          trackUrn: 'source:test:track:1',
          title: '幸福不是情歌',
          artist: '刘若英',
          lines: ['人生的挫折 好在有舍就有得', '曾真心付出的 都会是值得的'],
        },
      }),
    )
    expect(baseElement.textContent).toContain('分享歌词')
    expect(baseElement.textContent).toContain('人生的挫折 好在有舍就有得')
    expect(baseElement.textContent).toContain('复制歌词')
    expect(baseElement.textContent).toContain('下载图片')
  })

  it('renders ImportShareModal with dropzone and base64 input', () => {
    const ctx = new Context()
    const { baseElement } = render(
      h(ImportShareModal, {
        ctx,
        open: true,
        onClose: () => {},
      }),
    )
    expect(baseElement.textContent).toContain('读取 / 导入分享')
    expect(baseElement.textContent).toContain('拖放分享图片至此')
    expect(baseElement.textContent).toContain('或者直接粘贴 Base64 数据：')
  })
})
