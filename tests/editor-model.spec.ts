import { expect, test } from '@playwright/test'
import { beijingInput, formPayload, inputToIso, newForm, validateForm, type EditorSession } from '../src/editor-model'
import type { AnnouncementDetail } from '../src/types'

test('北京时间输入拒绝日期自动滚动，且跨年转换正确', () => {
  expect(inputToIso('2026-02-30T12:00:00')).toBeNull()
  expect(inputToIso('2026-01-01T00:01')).toBe('2025-12-31T16:01:00.000Z')
  expect(beijingInput('2026-10-07T13:22:00.123Z')).toBe('2026-10-07T21:22:00')
})

test('只编辑标题不改变原始毫秒，修改时间才按北京时间重新换算', () => {
  const form = { ...newForm(), publishedAt: '2026-10-07T21:22:00' }
  const detail = { announcement: { publishedAt: '2026-10-07T13:22:00.123Z' } } as AnnouncementDetail
  const session: EditorSession = { key: 'test', form, initial: structuredClone(form), detail }
  session.form.title['zh-CN'] = '已编辑标题'
  expect(formPayload(session).publishedAt).toBe('2026-10-07T13:22:00.123Z')
  session.form.publishedAt = '2026-10-07T21:22'
  expect(formPayload(session).publishedAt).toBe('2026-10-07T13:22:00.123Z')
  session.form.publishedAt = '2026-10-07T22:22:00'
  expect(formPayload(session).publishedAt).toBe('2026-10-07T14:22:00.000Z')
})

test('可选语言必须成对填写，版本与渠道问题分别定位', () => {
  const form = newForm()
  form.title['zh-CN'] = '标题'; form.content['zh-CN'] = '正文'
  form.title['en-US'] = 'Title'; form.channels = []; form.minAppVersion = 'not-a-version'
  const issues = validateForm(form)
  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: 'content', language: 'en-US' }),
    expect.objectContaining({ field: 'channels' }),
    expect.objectContaining({ field: 'minAppVersion' }),
  ]))
  expect(issues.some(issue => issue.language === 'ja-JP')).toBe(false)
})
