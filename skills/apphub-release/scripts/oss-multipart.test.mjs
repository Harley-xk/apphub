import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildCanonicalResource,
  buildCompleteXml,
  buildRequestPath,
  buildStringToSign,
  DEFAULT_MULTIPART_OPTIONS,
  formatBytes,
  MultipartError,
  multipartUpload,
  OSS_MAX_PARTS,
  parseUploadId,
  planParts,
  resolveMultipartOptions,
  sanitizeText,
  shouldUseMultipart,
} from './oss-multipart.mjs'

const PART = 100 * 1024
const CREDENTIAL = {
  region: 'oss-cn-hangzhou',
  bucket: 'apphub-test',
  accessKeyId: 'AKID-TEST',
  accessKeySecret: 'SECRET-TEST',
  securityToken: 'TOKEN-TEST',
}

const TRANSFER_OPTIONS = {
  ...DEFAULT_MULTIPART_OPTIONS,
  partSize: PART,
  concurrency: 2,
  retries: 2,
  partTimeoutMs: 1_000,
  progressIntervalMs: 1_000_000,
}

/** 可观测的传输替身（测试不发起真实 OSS 请求） */
function makeTransport(overrides = {}) {
  const calls = { initiate: [], parts: [], complete: [], abort: [], head: [] }
  return {
    calls,
    async initiate({ objectKey }) {
      calls.initiate.push(objectKey)
      return 'UPLOAD-1'
    },
    async uploadPart({ part }) {
      calls.parts.push(part.partNumber)
      return `"etag-${part.partNumber}"`
    },
    async complete({ parts }) {
      calls.complete.push(parts)
    },
    async abort({ uploadId }) {
      calls.abort.push(uploadId)
    },
    async head({ objectKey }) {
      calls.head.push(objectKey)
      return { contentLength: 300 * 1024 }
    },
    ...overrides,
  }
}

function run(transport, overrides = {}) {
  const warnings = []
  const logs = []
  const options = { ...TRANSFER_OPTIONS, ...overrides }
  return {
    warnings,
    logs,
    promise: multipartUpload({
      credential: CREDENTIAL,
      objectKey: 'packages/app/stable/1.0.0/a.zip',
      filePath: 'ignored.zip',
      fileSize: 300 * 1024,
      fileName: 'a.zip',
      label: 'windows-x64 安装包',
      options,
      transport,
      log: message => logs.push(message),
      warn: message => warnings.push(message),
      retryBaseDelayMs: 0,
      sleep: async () => {},
    }),
  }
}

describe('分片计划 planParts', () => {
  it('单分片的起止区间应为闭区间全文件', () => {
    assert.deepEqual(planParts(PART, PART), [{ partNumber: 1, start: 0, end: PART - 1, size: PART }])
  })

  it('普通分片与最后短分片的区间应正确', () => {
    const parts = planParts(PART * 2 + 123, PART)
    assert.equal(parts.length, 3)
    assert.deepEqual(parts[0], { partNumber: 1, start: 0, end: PART - 1, size: PART })
    assert.deepEqual(parts[1], { partNumber: 2, start: PART, end: PART * 2 - 1, size: PART })
    assert.deepEqual(parts[2], { partNumber: 3, start: PART * 2, end: PART * 2 + 122, size: 123 })
  })

  it('分片大小小于 100 KiB 时应拒绝', () => {
    assert.throws(() => planParts(PART * 2, 64 * 1024), /100 KiB/)
  })

  it('分片数超过 OSS 上限 10000 时应拒绝', () => {
    assert.throws(() => planParts(OSS_MAX_PARTS * PART + 1, PART), /超过 OSS 上限/)
  })

  it('分片大小超过 OSS 上限 5 GiB 时应拒绝', () => {
    assert.throws(() => planParts(6 * 1024 ** 3, 6 * 1024 ** 3), /5 GiB/)
  })

  it('空文件不能走 multipart', () => {
    assert.throws(() => planParts(0, PART), /空文件/)
  })
})

describe('传输选择 shouldUseMultipart', () => {
  const options = { mode: 'auto', threshold: 100, partSize: PART }

  it('严格大于阈值才启用 multipart', () => {
    assert.equal(shouldUseMultipart(options, 100), false)
    assert.equal(shouldUseMultipart(options, 101), true)
  })

  it('off 模式一律单次 PUT，空文件也不启用', () => {
    assert.equal(shouldUseMultipart({ ...options, mode: 'off' }, 1_000_000), false)
    assert.equal(shouldUseMultipart(options, 0), false)
  })
})

describe('签名与报文', () => {
  it('CanonicalizedResource 使用未编码原始键，子资源按键排序', () => {
    assert.equal(
      buildCanonicalResource('apphub-test', 'packages/a b/应用 1.0.exe', { partNumber: 3, uploadId: 'U-1' }),
      '/apphub-test/packages/a b/应用 1.0.exe?partNumber=3&uploadId=U-1',
    )
    assert.equal(buildCanonicalResource('apphub-test', 'packages/a.exe', { uploads: '' }), '/apphub-test/packages/a.exe?uploads')
  })

  it('请求路径只对路径段编码并保留 /', () => {
    assert.equal(
      buildRequestPath('packages/a b/应用 1.0.exe'),
      '/packages/a%20b/%E5%BA%94%E7%94%A8%201.0.exe',
    )
  })

  it('签名串五段结构与 OSS V1 一致', () => {
    const stringToSign = buildStringToSign({
      method: 'put',
      bucket: 'apphub-test',
      objectKey: 'packages/a.exe',
      subresources: { partNumber: 1, uploadId: 'U-1' },
      securityToken: 'TOKEN-TEST',
      date: 'Thu, 01 Jan 2026 00:00:00 GMT',
    })
    assert.equal(
      stringToSign,
      'PUT\n\n\nThu, 01 Jan 2026 00:00:00 GMT\n'
      + 'x-oss-security-token:TOKEN-TEST\n/apphub-test/packages/a.exe?partNumber=1&uploadId=U-1',
    )
  })

  it('Complete XML 乱序输入仍按 partNumber 升序并转义 ETag', () => {
    const xml = buildCompleteXml([
      { partNumber: 2, etag: '"b&<>\'"' },
      { partNumber: 1, etag: '"a"' },
    ])
    assert.ok(xml.indexOf('<PartNumber>1</PartNumber>') < xml.indexOf('<PartNumber>2</PartNumber>'))
    assert.ok(xml.includes('&quot;b&amp;&lt;&gt;&apos;&quot;'))
  })

  it('Complete XML 拒绝缺失、重复与空清单', () => {
    assert.throws(() => buildCompleteXml([]), /分片清单为空/)
    assert.throws(() => buildCompleteXml([{ partNumber: 2, etag: 'x' }]), /连续递增/)
    assert.throws(
      () => buildCompleteXml([{ partNumber: 1, etag: 'x' }, { partNumber: 1, etag: 'y' }]),
      /连续递增/,
    )
  })

  it('Initiate 响应应解析并解码 UploadId，缺失时不可重试地失败', () => {
    assert.equal(parseUploadId('<InitiateMultipartUploadResult><UploadId>abc&amp;1</UploadId></InitiateMultipartUploadResult>'), 'abc&1')
    assert.throws(() => parseUploadId('<InitiateMultipartUploadResult/>'), /缺少 UploadId/)
  })
})

describe('参数优先级 resolveMultipartOptions', () => {
  it('未配置时套用默认值', () => {
    assert.deepEqual(resolveMultipartOptions({}, {}), { ...DEFAULT_MULTIPART_OPTIONS })
  })

  it('CLI 参数优先于环境变量，环境变量优先于默认值', () => {
    const options = resolveMultipartOptions(
      {
        multipart: 'off',
        threshold: '1MiB',
        'part-size': '8MiB',
        concurrency: '8',
        retry: '0',
        'part-timeout': '30s',
        'progress-interval': '5s',
      },
      { APPHUB_MULTIPART_THRESHOLD_BYTES: '2MiB' },
    )
    assert.equal(options.mode, 'off')
    assert.equal(options.threshold, 1024 * 1024)
    assert.equal(options.partSize, 8 * 1024 * 1024)
    assert.equal(options.concurrency, 8)
    assert.equal(options.retries, 0)
    assert.equal(options.partTimeoutMs, 30_000)
    assert.equal(options.progressIntervalMs, 5_000)
  })

  it('空字符串按未设置处理', () => {
    const fromEnv = resolveMultipartOptions({ multipart: '' }, {
      APPHUB_MULTIPART: 'off',
      APPHUB_MULTIPART_CONCURRENCY: '2',
    })
    assert.equal(fromEnv.mode, 'off')
    assert.equal(fromEnv.concurrency, 2)
    assert.equal(resolveMultipartOptions({}, { APPHUB_MULTIPART_CONCURRENCY: '' }).concurrency, 4)
  })

  it('非法值直接失败，不静默回退默认值', () => {
    assert.throws(() => resolveMultipartOptions({ multipart: 'yes' }, {}), /auto \/ off/)
    assert.throws(() => resolveMultipartOptions({ concurrency: '0' }, {}), /concurrency/)
    assert.throws(() => resolveMultipartOptions({ threshold: 'abc' }, {}), /threshold/)
    assert.throws(() => resolveMultipartOptions({ retry: '-1' }, {}), /retry/)
    assert.throws(() => resolveMultipartOptions({ 'part-timeout': '0' }, {}), /part-timeout/)
  })
})

describe('multipartUpload 编排', () => {
  it('全部分片成功后按 partNumber 升序 Complete，并做 HEAD 大小校验', async () => {
    const transport = makeTransport()
    const { promise, logs, warnings } = run(transport)
    const result = await promise

    assert.equal(result.parts, 3)
    assert.deepEqual([...transport.calls.parts].sort((a, b) => a - b), [1, 2, 3])
    assert.deepEqual(transport.calls.complete[0], [
      { partNumber: 1, etag: '"etag-1"' },
      { partNumber: 2, etag: '"etag-2"' },
      { partNumber: 3, etag: '"etag-3"' },
    ])
    assert.deepEqual(transport.calls.head, ['packages/app/stable/1.0.0/a.zip'])
    assert.equal(transport.calls.abort.length, 0)
    assert.equal(warnings.length, 0)
    assert.ok(logs.some(message => message.includes('HEAD 大小校验通过')))
  })

  it('只重试失败分片，其他分片不重复', async () => {
    const transport = makeTransport()
    const attempts = new Map()
    transport.uploadPart = async ({ part }) => {
      const count = (attempts.get(part.partNumber) ?? 0) + 1
      attempts.set(part.partNumber, count)
      if (part.partNumber === 2 && count === 1)
        throw new MultipartError('模拟网络错误', { retryable: true })
      return `"etag-${part.partNumber}"`
    }

    const { promise, warnings } = run(transport)
    await promise
    assert.equal(attempts.get(1), 1)
    assert.equal(attempts.get(2), 2)
    assert.equal(attempts.get(3), 1)
    assert.ok(warnings.some(message => message.includes('分片 2 上传失败')))
  })

  it('不可重试错误应立即终止，尽力 Abort 且不调用 Complete', async () => {
    const transport = makeTransport()
    transport.uploadPart = async ({ part }) => {
      if (part.partNumber === 2)
        throw new MultipartError('分片对象不存在', { retryable: false, status: 404 })
      return `"etag-${part.partNumber}"`
    }

    const { promise } = run(transport)
    await assert.rejects(promise, /分片对象不存在/)
    assert.equal(transport.calls.complete.length, 0)
    assert.deepEqual(transport.calls.abort, ['UPLOAD-1'])
  })

  it('重试次数耗尽后终止，不调用 Complete', async () => {
    const transport = makeTransport()
    let attempts = 0
    transport.uploadPart = async () => {
      attempts++
      throw new MultipartError('持续失败', { retryable: true })
    }

    const { promise } = run(transport, { concurrency: 1 })
    await assert.rejects(promise, /持续失败/)
    assert.equal(attempts, TRANSFER_OPTIONS.retries + 1)
    assert.equal(transport.calls.complete.length, 0)
    assert.equal(transport.calls.abort.length, 1)
  })

  it('Abort 自身失败不应掩盖原始传输错误', async () => {
    const transport = makeTransport()
    transport.uploadPart = async () => {
      throw new MultipartError('原始传输错误', { retryable: false })
    }
    transport.abort = async () => {
      throw new Error('abort 服务异常')
    }

    const { promise, warnings } = run(transport, { concurrency: 1 })
    await assert.rejects(promise, /原始传输错误/)
    assert.ok(warnings.some(message => message.includes('中止分片会话失败')))
  })

  it('HEAD 403 仅告警并继续（STS 仅具备上传权限）', async () => {
    const transport = makeTransport()
    transport.head = async () => {
      throw new MultipartError('HEAD 校验失败：HTTP 403', { status: 403 })
    }

    const { promise, warnings } = run(transport)
    const result = await promise
    assert.equal(result.parts, 3)
    assert.ok(warnings.some(message => message.includes('HEAD 校验被拒绝（403')))
  })

  it('HEAD 大小不一致必须失败且不进入登记', async () => {
    const transport = makeTransport()
    transport.head = async () => ({ contentLength: 1 })

    const { promise } = run(transport)
    await assert.rejects(promise, /大小校验失败/)
    assert.equal(transport.calls.abort.length, 1)
  })
})

describe('日志与错误脱敏', () => {
  it('凭证片段在输出文本中应被替换为 ***', () => {
    assert.equal(
      sanitizeText('ak=AKID-TEST sk=SECRET-TEST token=TOKEN-TEST', CREDENTIAL),
      'ak=*** sk=*** token=***',
    )
    assert.equal(sanitizeText('无敏感信息', CREDENTIAL), '无敏感信息')
  })

  it('字节格式化应保持可读单位', () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(1536), '1.5 KiB')
    assert.equal(formatBytes(300 * 1024), '300.0 KiB')
  })
})
