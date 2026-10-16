<!--
  作者: Harley-xk
  创建: 2026-10-16

  描述: 安装包上传弹窗：STS 直传（对象键后端下发）+ 流式哈希自动计算 + 登记回调；ios 仅登记元信息
-->
<template>
  <el-dialog
    v-model="visible"
    title="上传安装包"
    width="600px"
    :close-on-click-modal="false"
    @closed="resetForm"
  >
    <el-alert
      v-if="framework === 'electron'"
      type="info"
      :closable="false"
      show-icon
      title="Electron 应用发布须登记 sha512（选择文件后自动计算）；可附带 .blockmap 差分文件获得差量更新"
      class="tip-bar"
    />
    <el-alert
      v-else-if="framework === 'tauri'"
      type="info"
      :closable="false"
      show-icon
      title="Tauri 应用发布须登记 minisign 签名（构建时 tauri signer sign 生成的 .sig 内容）"
      class="tip-bar"
    />

    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="平台" prop="platform">
        <el-radio-group v-model="form.platform" @update:model-value="handlePlatformChange">
          <el-radio-button value="windows">
            Windows
          </el-radio-button>
          <el-radio-button value="macos">
            macOS
          </el-radio-button>
          <el-radio-button value="linux">
            Linux
          </el-radio-button>
          <el-radio-button value="android">
            Android
          </el-radio-button>
          <el-radio-button value="ios">
            iOS
          </el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="isDesktop" label="架构" prop="arch">
        <el-radio-group v-model="form.arch">
          <el-radio-button value="x64">
            x64
          </el-radio-button>
          <el-radio-button value="arm64">
            arm64
          </el-radio-button>
          <el-radio-button value="universal">
            universal
          </el-radio-button>
        </el-radio-group>
      </el-form-item>

      <template v-if="form.platform !== 'ios'">
        <el-form-item label="安装包" prop="fileName">
          <el-upload
            drag
            :auto-upload="false"
            :limit="1"
            :on-change="handleFileChange"
            :on-remove="() => clearFile()"
          >
            <div class="upload-hint">
              <p>拖拽文件到此处，或点击选择</p>
              <p class="upload-sub">
                {{ isDesktop ? '安装包（exe / dmg / AppImage 等）' : 'APK 安装包' }}
              </p>
            </div>
          </el-upload>
        </el-form-item>
        <el-form-item v-if="framework === 'electron'" label="blockmap">
          <el-upload
            drag
            :auto-upload="false"
            :limit="1"
            :on-change="handleBlockmapChange"
            :on-remove="() => clearBlockmap()"
          >
            <div class="upload-hint">
              <p>可选：.blockmap 差分文件（electron-builder 产物）</p>
            </div>
          </el-upload>
        </el-form-item>
      </template>
      <el-form-item v-else label="登记文件名" prop="fileName">
        <el-input v-model="form.fileName" placeholder="如 MyApp-1.3.0.ipa（仅登记元信息，不走直传）" maxlength="255" />
      </el-form-item>

      <el-form-item v-if="framework === 'tauri' && form.platform !== 'ios'" label="minisign 签名" prop="minisignSignature">
        <el-input
          v-model="form.minisignSignature"
          type="textarea"
          :rows="2"
          placeholder="粘贴构建产物 .sig 文件内容（发布前置校验必填）"
        />
      </el-form-item>

      <el-form-item v-if="hash" label="sha256（自动）">
        <code class="hash-value">{{ hash.sha256 }}</code>
      </el-form-item>
      <el-form-item v-if="hash" label="sha512（自动）">
        <code class="hash-value">{{ hash.sha512 }}</code>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">
        取消
      </el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ stage || '上传并登记' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules, type UploadFile } from 'element-plus'
import { computed, reactive, ref } from 'vue'

import type { PackageRegisterData } from '@/api/appcenter/package'
import { issueUploadToken, registerPackage } from '@/api/appcenter/package'
import type { VersionVO } from '@/api/appcenter/version'
import { hashFile, IOS_SHA256_PLACEHOLDER, putObject } from '@/views/appcenter/version/useOssUploader'

const emit = defineEmits<{ saved: [] }>()

/** 上传上下文：草稿版本与应用框架（框架决定配套产物提示与登记字段） */
const version = ref<VersionVO | null>(null)
const framework = ref<string | null>(null)

const visible = ref(false)
const submitting = ref(false)
/** 上传阶段提示（计算哈希 → 申请凭证 → 直传 → 登记） */
const stage = ref('')
const formRef = ref<FormInstance>()

const DESKTOP_PLATFORMS = ['windows', 'macos', 'linux']

const form = reactive({
  platform: 'windows',
  arch: 'x64',
  fileName: '',
  minisignSignature: '',
})

const file = ref<File | null>(null)
const blockmapFile = ref<File | null>(null)
const hash = ref<{ sha256: string, sha512: string } | null>(null)
const blockmapHash = ref<{ sha512: string, size: number } | null>(null)

const isDesktop = computed(() => DESKTOP_PLATFORMS.includes(form.platform))

const rules: FormRules = {
  platform: [{ required: true, message: '请选择平台', trigger: 'change' }],
  arch: [{ required: true, message: '请选择架构', trigger: 'change' }],
  fileName: [{ required: true, message: '请提供安装包文件', trigger: 'change' }],
  minisignSignature: [
    { required: true, message: 'Tauri 应用发布须登记 minisign 签名', trigger: 'blur' },
  ],
}

/** 打开弹窗（仅草稿版本可上传，入口由包面板按状态控制） */
function open(context: { version: VersionVO, framework: string | null }): void {
  version.value = context.version
  framework.value = context.framework
  visible.value = true
}

function resetForm(): void {
  formRef.value?.resetFields()
  form.platform = 'windows'
  form.arch = 'x64'
  form.fileName = ''
  form.minisignSignature = ''
  file.value = null
  blockmapFile.value = null
  hash.value = null
  blockmapHash.value = null
  stage.value = ''
}

function handlePlatformChange(): void {
  clearFile()
  clearBlockmap()
}

async function handleFileChange(uploadFile: UploadFile): Promise<void> {
  const raw = uploadFile.raw
  if (!raw) {
    return
  }
  file.value = raw
  form.fileName = raw.name
  stage.value = '计算哈希中…'
  hash.value = await hashFile(raw)
  stage.value = ''
}

async function handleBlockmapChange(uploadFile: UploadFile): Promise<void> {
  const raw = uploadFile.raw
  if (!raw) {
    return
  }
  blockmapFile.value = raw
  blockmapHash.value = { sha512: (await hashFile(raw)).sha512, size: raw.size }
}

function clearFile(): void {
  file.value = null
  hash.value = null
  form.fileName = ''
}

function clearBlockmap(): void {
  blockmapFile.value = null
  blockmapHash.value = null
}

async function handleSubmit(): Promise<void> {
  const target = version.value
  if (!target) {
    return
  }
  const valid = await formRef.value?.validate().then(() => true).catch(() => false)
  if (!valid) {
    return
  }

  submitting.value = true
  try {
    let register: PackageRegisterData

    if (form.platform === 'ios') {
      // iOS 仅登记元信息（App Store 分发，不走 OSS 直传，sha256 全零占位）
      register = {
        platform: form.platform,
        fileName: form.fileName,
        sha256: IOS_SHA256_PLACEHOLDER,
      }
    }
    else {
      if (!file.value || !hash.value) {
        ElMessage.warning('请选择安装包文件')
        return
      }
      stage.value = '申请直传凭证…'
      const token = await issueUploadToken(target.id, {
        platform: form.platform,
        ...(isDesktop.value ? { arch: form.arch } : {}),
        fileName: file.value.name,
      })
      stage.value = '直传 OSS…'
      await putObject(token, token.objectKey, file.value)
      if (blockmapFile.value && blockmapHash.value) {
        await putObject(token, token.blockmapObjectKey, blockmapFile.value)
      }
      register = {
        platform: form.platform,
        ...(isDesktop.value ? { arch: form.arch } : {}),
        fileName: file.value.name,
        objectKey: token.objectKey,
        sha256: hash.value.sha256,
        sha512: hash.value.sha512,
        ...(blockmapHash.value
          ? { blockmapSha512: blockmapHash.value.sha512, blockmapFileSize: blockmapHash.value.size }
          : {}),
      }
    }
    if (form.platform !== 'ios' && framework.value === 'tauri') {
      register.minisignSignature = form.minisignSignature
    }

    stage.value = '登记包记录…'
    await registerPackage(target.id, register)
    ElMessage.success('上传并登记成功')
    visible.value = false
    emit('saved')
  }
  finally {
    stage.value = ''
    submitting.value = false
  }
}

defineExpose({ open })
</script>

<style scoped>
.tip-bar {
  margin-bottom: 16px;
}

.upload-hint {
  padding: 12px 0;
  text-align: center;
}

.upload-sub {
  color: var(--apphub-text-secondary, #909399);
  font-size: 12px;
}

.hash-value {
  display: block;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace;
  font-size: 12px;
}
</style>
