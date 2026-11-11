/*
 * 作者: Harley-xk
 * 创建: 2026-11-11
 *
 * 描述: OSS multipart 直传：分片计划 / V1 签名 / 固定并发 / 分片级重试与无进展超时 / 进度 / Complete / Abort / HEAD 校验（零第三方依赖）
 * 设计依据: docs/应用管理平台/发版Skill设计.md §8（改造需求见 docs/指南/AppHub skill OSS分片上传上游改造说明.md）
 */
import { createHmac } from 'node:crypto'
import { createReadStream } from 'node:fs'
import https from 'node:https'
import path from 'node:path'

/** OSS 分片数上限与分片大小上下限（最后一片可短） */
export const OSS_MAX_PARTS = 10_000
export const OSS_MIN_PART_SIZE = 100 * 1024
export const OSS_MAX_PART_SIZE = 5 * 1024 * 1024 * 1024

/** 默认传输参数（优先级：CLI 参数 > 环境变量 > 默认值） */
export const DEFAULT_MULTIPART_OPTIONS = Object.freeze({
  mode: 'auto',
  threshold: 64 * 1024 * 1024,
  partSize: 16 * 1024 * 1024,
  concurrency: 4,
  retries: 3,
  partTimeoutMs: 90_000,
  progressIntervalMs: 15_000,
})

/** CLI 参数 ↔ 环境变量映射（空字符串按未设置处理） */
const ENV_KEYS = Object.freeze({
  multipart: 'APPHUB_MULTIPART',
  threshold: 'APPHUB_MULTIPART_THRESHOLD_BYTES',
  'part-size': 'APPHUB_MULTIPART_PART_SIZE_BYTES',
  concurrency: 'APPHUB_MULTIPART_CONCURRENCY',
  retry: 'APPHUB_MULTIPART_RETRIES',
  'part-timeout': 'APPHUB_MULTIPART_PART_TIMEOUT_MS',
  'progress-interval': 'APPHUB_MULTIPART_PROGRESS_INTERVAL_MS',
})

const SIZE_UNITS = Object.freeze({
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  KIB: 2 ** 10,
  MIB: 2 ** 20,
  GIB: 2 ** 30,
  TIB: 2 ** 40,
})

const DURATION_UNITS = Object.freeze({ MS: 1, S: 1_000, M: 60_000, H: 3_600_000 })

/* ---------------------------------- 错误类型 ---------------------------------- */

export class MultipartError extends Error {
  constructor(message, { retryable = false, status, code, cause } = {}) {
    super(message)
    this.name = 'MultipartError'
    this.retryable = retryable
    this.status = status
    this.code = code
    if (cause)
      this.cause = cause
  }
}

export class MultipartConfigError extends MultipartError {
  constructor(message) {
    super(message)
    this.name = 'MultipartConfigError'
  }
}

/* ---------------------------------- 参数解析（CLI > 环境变量 > 默认值） ---------------------------------- */

function isUnset(value) {
  return value === undefined || value === null || value === ''
}

function optionLabel(cliKey, envKey) {
  return `--${cliKey} / ${envKey}`
}

/** 解析字节数：支持纯数字（字节）与 64MiB / 16MB / 100KiB 这类带单位写法 */
export function parseByteSize(value, label = '字节数') {
  const text = String(value).trim()
  const match = /^(\d+(?:\.\d+)?)\s*([KMGT]?I?B)?$/i.exec(text)
  if (!match)
    throw new MultipartConfigError(`${label} 取值非法：${String(value)}（支持字节数或 64MiB 这类带单位写法）`)
  const unit = (match[2] ?? 'B').toUpperCase()
  const bytes = Number(match[1]) * SIZE_UNITS[unit]
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new MultipartConfigError(`${label} 取值非法：${String(value)}（须为不小于 0 的整数字节）`)
  return bytes
}

/** 解析时长：支持纯数字（毫秒）与 90s / 1500ms 写法 */
export function parseDurationMs(value, label = '时长') {
  const text = String(value).trim()
  const match = /^(\d+(?:\.\d+)?)\s*(MS|S|M|H)?$/i.exec(text)
  if (!match)
    throw new MultipartConfigError(`${label} 取值非法：${String(value)}（支持毫秒或 90s 这类写法）`)
  const unit = (match[2] ?? 'MS').toUpperCase()
  const ms = Number(match[1]) * DURATION_UNITS[unit]
  if (!Number.isSafeInteger(ms) || ms <= 0)
    throw new MultipartConfigError(`${label} 取值非法：${String(value)}（须为大于 0 的整数毫秒）`)
  return ms
}

function parseInteger(value, label, min) {
  const text = String(value).trim()
  if (!/^\d+$/.test(text))
    throw new MultipartConfigError(`${label} 取值非法：${String(value)}（须为不小于 ${min} 的整数）`)
  const number = Number(text)
  if (!Number.isSafeInteger(number) || number < min)
    throw new MultipartConfigError(`${label} 取值非法：${String(value)}（须为不小于 ${min} 的整数）`)
  return number
}

/** 读取单个参数：CLI 非空优先，其次非空环境变量，最后返回 undefined */
function pickOption(cliValues, env, cliKey) {
  const fromCli = cliValues?.[cliKey]
  if (!isUnset(fromCli))
    return fromCli
  const fromEnv = env?.[ENV_KEYS[cliKey]]
  if (!isUnset(fromEnv))
    return fromEnv
  return undefined
}

/** 汇总 multipart 传输参数；非法值直接抛错，不静默套用默认值 */
export function resolveMultipartOptions(cliValues = {}, env = process.env) {
  const rawMode = pickOption(cliValues, env, 'multipart')
  const mode = String(rawMode ?? DEFAULT_MULTIPART_OPTIONS.mode).trim().toLowerCase()
  if (mode !== 'auto' && mode !== 'off')
    throw new MultipartConfigError(`${optionLabel('multipart', ENV_KEYS.multipart)} 取值须为 auto / off（当前：${String(rawMode)}）`)

  const rawThreshold = pickOption(cliValues, env, 'threshold')
  const rawPartSize = pickOption(cliValues, env, 'part-size')
  const rawConcurrency = pickOption(cliValues, env, 'concurrency')
  const rawRetry = pickOption(cliValues, env, 'retry')
  const rawPartTimeout = pickOption(cliValues, env, 'part-timeout')
  const rawProgressInterval = pickOption(cliValues, env, 'progress-interval')

  return {
    mode,
    threshold: rawThreshold === undefined
      ? DEFAULT_MULTIPART_OPTIONS.threshold
      : parseByteSize(rawThreshold, optionLabel('threshold', ENV_KEYS.threshold)),
    partSize: rawPartSize === undefined
      ? DEFAULT_MULTIPART_OPTIONS.partSize
      : parseByteSize(rawPartSize, optionLabel('part-size', ENV_KEYS['part-size'])),
    concurrency: rawConcurrency === undefined
      ? DEFAULT_MULTIPART_OPTIONS.concurrency
      : parseInteger(rawConcurrency, optionLabel('concurrency', ENV_KEYS.concurrency), 1),
    retries: rawRetry === undefined
      ? DEFAULT_MULTIPART_OPTIONS.retries
      : parseInteger(rawRetry, optionLabel('retry', ENV_KEYS.retry), 0),
    partTimeoutMs: rawPartTimeout === undefined
      ? DEFAULT_MULTIPART_OPTIONS.partTimeoutMs
      : parseDurationMs(rawPartTimeout, optionLabel('part-timeout', ENV_KEYS['part-timeout'])),
    progressIntervalMs: rawProgressInterval === undefined
      ? DEFAULT_MULTIPART_OPTIONS.progressIntervalMs
      : parseDurationMs(rawProgressInterval, optionLabel('progress-interval', ENV_KEYS['progress-interval'])),
  }
}

/* ---------------------------------- 传输选择与分片计划 ---------------------------------- */

/** 是否对该对象启用 multipart：off 一律单次；auto 按对象大小独立判断（严格大于阈值） */
export function shouldUseMultipart(options, fileSize) {
  if (options.mode === 'off')
    return false
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0)
    return false
  return fileSize > options.threshold
}

/** 生成分片计划：partNumber 从 1 开始，闭区间 [start, end]，最后一片可短 */
export function planParts(fileSize, partSize) {
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0)
    throw new MultipartConfigError(`分片文件大小非法：${String(fileSize)}（空文件不能走 multipart）`)
  if (!Number.isSafeInteger(partSize) || partSize <= 0)
    throw new MultipartConfigError(`分片大小非法：${String(partSize)}（须为正整数字节）`)
  if (partSize < OSS_MIN_PART_SIZE)
    throw new MultipartConfigError(`分片大小不得小于 OSS 最小分片限制 100 KiB（当前：${partSize} 字节）`)
  if (partSize > OSS_MAX_PART_SIZE)
    throw new MultipartConfigError(`分片大小不得超过 OSS 上限 5 GiB（当前：${partSize} 字节）`)
  const count = Math.ceil(fileSize / partSize)
  if (count > OSS_MAX_PARTS)
    throw new MultipartConfigError(`分片数 ${count} 超过 OSS 上限 ${OSS_MAX_PARTS}，请增大 --part-size`)
  const parts = []
  for (let index = 0; index < count; index++) {
    const start = index * partSize
    const end = Math.min(start + partSize, fileSize) - 1
    parts.push({ partNumber: index + 1, start, end, size: end - start + 1 })
  }
  return parts
}

/* ---------------------------------- 签名与报文 ---------------------------------- */

function sortedEntries(subresources) {
  return Object.entries(subresources ?? {})
    .filter(([key]) => key)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
}

/**
 * CanonicalizedResource 使用未编码的 /{bucket}/{objectKey}，并按字典序附带参与签名的子资源。
 * 注意：请求路径必须另行按路径段编码，两者不可混用。
 */
export function buildCanonicalResource(bucket, objectKey, subresources = {}) {
  const entries = sortedEntries(subresources)
  if (entries.length === 0)
    return `/${bucket}/${objectKey}`
  const query = entries
    .map(([key, value]) => (value === '' || value === null || value === undefined ? key : `${key}=${value}`))
    .join('&')
  return `/${bucket}/${objectKey}?${query}`
}

/** HTTP 请求路径：只对 objectKey 的每个路径段做 URL 编码，保留 / */
export function buildRequestPath(objectKey) {
  return `/${objectKey.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
}

function buildQueryString(subresources = {}) {
  const entries = sortedEntries(subresources)
  if (entries.length === 0)
    return ''
  const query = entries
    .map(([key, value]) => (value === '' || value === null || value === undefined
      ? encodeURIComponent(key)
      : `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`))
    .join('&')
  return `?${query}`
}

/** OSS V1 签名串：VERB \n Content-MD5 \n Content-Type \n Date \n CanonicalizedOSSHeaders + CanonicalizedResource */
export function buildStringToSign({ method, bucket, objectKey, subresources = {}, securityToken, date, contentType = '' }) {
  const canonicalResource = buildCanonicalResource(bucket, objectKey, subresources)
  return [
    method.toUpperCase(),
    '',
    contentType,
    date,
    `x-oss-security-token:${securityToken}\n${canonicalResource}`,
  ].join('\n')
}

export function buildAuthorization(credential, options) {
  const stringToSign = buildStringToSign({ bucket: credential.bucket, ...options })
  const signature = createHmac('sha1', credential.accessKeySecret).update(stringToSign).digest('base64')
  return `OSS ${credential.accessKeyId}:${signature}`
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
}

export function parseUploadId(xmlText) {
  const match = /<UploadId>([^<]*)<\/UploadId>/.exec(xmlText ?? '')
  if (!match || !match[1])
    throw new MultipartError('InitiateMultipartUpload 响应缺少 UploadId（协议字段缺失，不可重试）')
  return decodeXmlEntities(match[1])
}

/** Complete XML 必须按 partNumber 升序、序号连续、ETag 转义 */
export function buildCompleteXml(parts) {
  if (!Array.isArray(parts) || parts.length === 0)
    throw new MultipartError('CompleteMultipartUpload 分片清单为空')
  const sorted = [...parts].sort((left, right) => left.partNumber - right.partNumber)
  for (let index = 0; index < sorted.length; index++) {
    if (sorted[index].partNumber !== index + 1)
      throw new MultipartError('CompleteMultipartUpload 分片序号必须从 1 连续递增（不可缺失或重复）')
    if (!sorted[index].etag)
      throw new MultipartError(`CompleteMultipartUpload 缺少分片 ${sorted[index].partNumber} 的 ETag`)
  }
  const body = sorted
    .map(part => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>${body}</CompleteMultipartUpload>`
}

/* ---------------------------------- 错误脱敏 ---------------------------------- */

export function parseOssError(text) {
  const code = /<Code>([^<]+)<\/Code>/.exec(text ?? '')?.[1]
  const message = /<Message>([^<]+)<\/Message>/.exec(text ?? '')?.[1]
  return { code, message }
}

/** 日志与错误统一脱敏：任何凭证片段都不允许出现在输出中 */
export function sanitizeText(text, credential) {
  let result = String(text ?? '')
  for (const secret of [credential?.accessKeySecret, credential?.accessKeyId, credential?.securityToken]) {
    if (secret)
      result = result.split(secret).join('***')
  }
  return result
}

function describeOssResponse(response, credential) {
  const text = response.body?.toString('utf8') ?? ''
  const { code, message } = parseOssError(text)
  const detail = code
    ? `${code}: ${message ?? ''}`
    : (text.slice(0, 200) || '（空响应体）')
  return `HTTP ${response.statusCode} ${sanitizeText(detail, credential)}`
}

function isRetryableStatus(statusCode) {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500
}

function httpError(response, credential, { retryable }) {
  return new MultipartError(`OSS 请求失败：${describeOssResponse(response, credential)}`, {
    retryable,
    status: response.statusCode,
  })
}

/* ---------------------------------- 底层 HTTPS 请求 ---------------------------------- */

function buildHost(credential) {
  return `${credential.bucket}.${credential.region.includes('.') ? credential.region : `${credential.region}.aliyuncs.com`}`
}

function toNetworkError(error) {
  if (error instanceof MultipartError)
    return error
  return new MultipartError(`OSS 请求失败：${error.message}`, {
    retryable: true,
    code: error.code,
    cause: error,
  })
}

/**
 * 单次 OSS 请求（流式上传分片时不整读内存）。
 * timeoutMs 为「无进展超时」：socket 持续无活动即终止当前请求。
 */
function requestOss({
  credential,
  method,
  objectKey,
  subresources = {},
  contentType = '',
  contentLength,
  body,
  stream,
  timeoutMs = 0,
}) {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString()
    const headers = {
      Date: date,
      'x-oss-security-token': credential.securityToken,
      Authorization: buildAuthorization(credential, { method, objectKey, subresources, date, contentType }),
    }
    if (contentType)
      headers['Content-Type'] = contentType
    if (contentLength !== undefined)
      headers['Content-Length'] = contentLength

    let settled = false
    const finish = (callback, value) => {
      if (settled)
        return
      settled = true
      callback(value)
    }
    const destroyStream = () => {
      if (stream && !stream.destroyed)
        stream.destroy()
    }

    const request = https.request(
      {
        hostname: buildHost(credential),
        path: `${buildRequestPath(objectKey)}${buildQueryString(subresources)}`,
        method,
        headers,
      },
      (response) => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('error', (error) => {
          destroyStream()
          finish(reject, toNetworkError(error))
        })
        response.on('end', () => {
          // 服务端提前拒绝时不再继续读取本地分片，避免句柄滞留
          if (stream && (response.statusCode ?? 0) >= 400) {
            destroyStream()
            request.destroy()
          }
          finish(resolve, {
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        })
      },
    )

    request.on('error', (error) => {
      destroyStream()
      finish(reject, toNetworkError(error))
    })
    if (timeoutMs > 0) {
      request.setTimeout(timeoutMs, () => {
        // 先落定超时错误，再销毁请求（避免 destroy 触发的网络错误覆盖超时语义）
        finish(reject, new MultipartError(`OSS 请求无进展超时（${timeoutMs}ms）`, {
          retryable: true,
          code: 'TIMEOUT',
        }))
        destroyStream()
        request.destroy()
      })
    }

    if (stream) {
      stream.on('error', (error) => {
        finish(reject, new MultipartError(`读取本地文件失败：${error.message}`, { retryable: true, cause: error }))
        request.destroy()
      })
      stream.pipe(request)
    }
    else if (body !== undefined) {
      request.end(body)
    }
    else {
      request.end()
    }
  })
}

/* ---------------------------------- OSS 传输实现（可注入替身测试） ---------------------------------- */

/** 创建默认 OSS 传输实现：initiate / uploadPart / complete / abort / head */
export function createOssTransport(credential) {
  return {
    async initiate({ objectKey, timeoutMs }) {
      const response = await requestOss({
        credential,
        method: 'POST',
        objectKey,
        subresources: { uploads: '' },
        timeoutMs,
      })
      if (response.statusCode !== 200)
        throw httpError(response, credential, { retryable: isRetryableStatus(response.statusCode) })
      return parseUploadId(response.body.toString('utf8'))
    },

    async uploadPart({ objectKey, uploadId, part, filePath, timeoutMs }) {
      const stream = createReadStream(filePath, { start: part.start, end: part.end })
      const response = await requestOss({
        credential,
        method: 'PUT',
        objectKey,
        subresources: { partNumber: part.partNumber, uploadId },
        contentLength: part.size,
        stream,
        timeoutMs,
      })
      if (response.statusCode < 200 || response.statusCode >= 300)
        throw httpError(response, credential, { retryable: isRetryableStatus(response.statusCode) })
      const etag = response.headers.etag
      if (!etag)
        throw new MultipartError(`分片 ${part.partNumber} 响应缺少 ETag（可重试）`, { retryable: true })
      return etag
    },

    async complete({ objectKey, uploadId, parts, timeoutMs }) {
      const body = buildCompleteXml(parts)
      const response = await requestOss({
        credential,
        method: 'POST',
        objectKey,
        subresources: { uploadId },
        contentType: 'application/xml',
        contentLength: Buffer.byteLength(body),
        body,
        timeoutMs,
      })
      const text = response.body.toString('utf8')
      // Complete 可能返回 200 但正文为 <Error>（OSS 回调等场景），同样视为失败
      if (response.statusCode !== 200 || /<Error>/.test(text))
        throw new MultipartError(`CompleteMultipartUpload 失败：${describeOssResponse(response, credential)}`, {
          status: response.statusCode,
        })
    },

    async abort({ objectKey, uploadId, timeoutMs }) {
      const response = await requestOss({
        credential,
        method: 'DELETE',
        objectKey,
        subresources: { uploadId },
        timeoutMs,
      })
      const text = response.body.toString('utf8')
      // 会话已不存在视为清理完成
      if (response.statusCode === 404 || /<Code>NoSuchUpload<\/Code>/.test(text))
        return
      if (response.statusCode < 200 || response.statusCode >= 300)
        throw new MultipartError(`AbortMultipartUpload 失败：${describeOssResponse(response, credential)}`, {
          status: response.statusCode,
        })
    },

    async head({ objectKey, timeoutMs }) {
      const response = await requestOss({ credential, method: 'HEAD', objectKey, timeoutMs })
      if (response.statusCode === 200) {
        const contentLength = Number(response.headers['content-length'])
        if (!Number.isFinite(contentLength))
          throw new MultipartError('HEAD 响应缺少 content-length')
        return { contentLength }
      }
      throw new MultipartError(`HEAD 校验失败：${describeOssResponse(response, credential)}`, {
        status: response.statusCode,
      })
    },
  }
}

/* ---------------------------------- 进度与重试 ---------------------------------- */

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0)
    return '0 B'
  if (bytes < 1024)
    return `${Math.round(bytes)} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 'B'
  for (const next of units) {
    if (value < 1024)
      break
    value /= 1024
    unit = next
  }
  return `${value.toFixed(1)} ${unit}`
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0)
    return '00:00'
  const total = Math.ceil(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = value => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`
}

/** 进度：达到新的 5% 或超过静默间隔时输出，避免长时间无日志 */
function createProgress({ prefix, fileSize, totalParts, intervalMs, log }) {
  const startedAt = Date.now()
  let uploadedBytes = 0
  let completedParts = 0
  let lastBucket = -1
  let lastLogAt = startedAt

  const report = () => {
    const percent = fileSize > 0 ? (uploadedBytes / fileSize) * 100 : 100
    const now = Date.now()
    lastBucket = Math.max(lastBucket, Math.floor(percent / 5))
    lastLogAt = now
    const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001)
    const speed = uploadedBytes / elapsedSeconds
    const etaSeconds = speed > 0 ? Math.max(fileSize - uploadedBytes, 0) / speed : 0
    log(
      `  ${prefix}multipart ${completedParts}/${totalParts} 分片, `
      + `${formatBytes(uploadedBytes)}/${formatBytes(fileSize)} (${percent.toFixed(1)}%), `
      + `${formatBytes(speed)}/s, ETA ${formatEta(etaSeconds)}`,
    )
  }

  return {
    onPartComplete(part) {
      uploadedBytes += part.size
      completedParts++
      const percent = fileSize > 0 ? (uploadedBytes / fileSize) * 100 : 100
      if (Math.floor(percent / 5) > lastBucket || Date.now() - lastLogAt >= intervalMs)
        report()
    },
    /** 长时间无新进度时由心跳补一条，避免正常情况下长时间静默 */
    heartbeat() {
      if (Date.now() - lastLogAt >= intervalMs)
        report()
    },
  }
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** 分片级重试：仅重试失败分片；指数退避 + 随机抖动 */
async function withRetry(action, { retries, baseDelayMs, sleep, onRetry }) {
  let attempt = 0
  for (;;) {
    try {
      return await action()
    }
    catch (error) {
      if (!error?.retryable || attempt >= retries)
        throw error
      attempt++
      const delay = Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5))
      onRetry(error, attempt, delay)
      await sleep(delay)
    }
  }
}

/** 固定并发 worker 池：一个分片最终失败后不再调度新分片，等待已发出的请求结束 */
async function runPool(items, concurrency, worker) {
  let next = 0
  let failure = null
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      if (failure)
        return
      const index = next++
      if (index >= items.length)
        return
      try {
        await worker(items[index])
      }
      catch (error) {
        failure ??= error
        return
      }
    }
  })
  await Promise.all(workers)
  if (failure)
    throw failure
}

/* ---------------------------------- 编排 ---------------------------------- */

async function abortQuietly({ transport, objectKey, uploadId, prefix, warn, timeoutMs }) {
  try {
    await transport.abort({ objectKey, uploadId, timeoutMs })
    warn(`  ${prefix}已中止分片会话（包记录未登记）`)
  }
  catch (error) {
    warn(`  ${prefix}中止分片会话失败（依赖 OSS 生命周期清理）：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function verifyCompletedSize({ transport, objectKey, expectedSize, prefix, log, warn, timeoutMs }) {
  let head
  try {
    head = await transport.head({ objectKey, timeoutMs })
  }
  catch (error) {
    // STS 仅具备上传权限时 HEAD 返回 403：记录警告后按「全部分片成功且 Complete 成功」判定完成
    if (error?.status === 403) {
      warn(`  ${prefix}HEAD 校验被拒绝（403，STS 仅具备上传权限），按「全部分片成功且 Complete 成功」判定完成`)
      return
    }
    throw error
  }
  if (head.contentLength !== expectedSize)
    throw new MultipartError(`Complete 后大小校验失败：OSS ${head.contentLength} 字节 ≠ 本地 ${expectedSize} 字节`)
  log(`  ${prefix}HEAD 大小校验通过：${expectedSize} 字节`)
}

/**
 * 对单个对象执行 multipart 上传。
 * - 全部分片成功后按 partNumber 升序 Complete
 * - 任一失败（含 Complete / HEAD 校验）尽力 Abort，绝不进入包登记
 * - transport 可注入替身用于自动化测试
 */
export async function multipartUpload({
  credential,
  objectKey,
  filePath,
  fileSize,
  fileName = path.basename(filePath),
  label = '',
  options = DEFAULT_MULTIPART_OPTIONS,
  transport,
  log = message => console.log(message),
  warn = message => console.warn(message),
  verifySize = true,
  retryBaseDelayMs = 500,
  sleep = defaultSleep,
}) {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1)
    throw new MultipartConfigError(`分片并发数非法：${String(options.concurrency)}（须为正整数）`)
  if (!Number.isSafeInteger(options.retries) || options.retries < 0)
    throw new MultipartConfigError(`分片重试次数非法：${String(options.retries)}（须为非负整数）`)

  const parts = planParts(fileSize, options.partSize)
  const client = transport ?? createOssTransport(credential)
  const prefix = label ? `[${label}] ` : ''
  log(
    `  ${prefix}${fileName} ${formatBytes(fileSize)} → multipart`
    + `（${formatBytes(options.partSize)} × ${parts.length} 片，并发 ${options.concurrency}，重试 ${options.retries}）`,
  )

  const uploadId = await client.initiate({ objectKey, timeoutMs: options.partTimeoutMs })
  const etags = new Map()
  const progress = createProgress({
    prefix,
    fileSize,
    totalParts: parts.length,
    intervalMs: options.progressIntervalMs,
    log,
  })
  const heartbeat = options.progressIntervalMs > 0
    ? setInterval(() => progress.heartbeat(), options.progressIntervalMs)
    : null
  heartbeat?.unref?.()

  try {
    await runPool(parts, options.concurrency, async (part) => {
      const etag = await withRetry(
        () => client.uploadPart({ objectKey, uploadId, part, filePath, timeoutMs: options.partTimeoutMs }),
        {
          retries: options.retries,
          baseDelayMs: retryBaseDelayMs,
          sleep,
          onRetry: (error, attempt, delay) => warn(
            `  ${prefix}分片 ${part.partNumber} 上传失败（${delay}ms 后第 ${attempt}/${options.retries} 次重试）：`
            + `${error instanceof Error ? error.message : String(error)}`,
          ),
        },
      )
      etags.set(part.partNumber, etag)
      progress.onPartComplete(part)
    })

    await client.complete({
      objectKey,
      uploadId,
      parts: parts.map(part => ({ partNumber: part.partNumber, etag: etags.get(part.partNumber) })),
      timeoutMs: options.partTimeoutMs,
    })
    log(`  ${prefix}multipart 完成：${parts.length} 片全部上传并 Complete`)

    if (verifySize) {
      await verifyCompletedSize({
        transport: client,
        objectKey,
        expectedSize: fileSize,
        prefix,
        log,
        warn,
        timeoutMs: options.partTimeoutMs,
      })
    }
    return { parts: parts.length }
  }
  catch (error) {
    await abortQuietly({
      transport: client,
      objectKey,
      uploadId,
      prefix,
      warn,
      timeoutMs: options.partTimeoutMs,
    })
    throw error
  }
  finally {
    if (heartbeat)
      clearInterval(heartbeat)
  }
}
