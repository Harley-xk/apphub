<!--
  作者: Harley-xk
  创建: 2026-10-23

  描述: 应用图标上传组件：选择图片即经 STS 凭证直传 OSS，v-model 输出对象键；编辑态回显后端签名预览
-->
<template>
  <div class="icon-upload">
    <div class="icon-preview" :class="{ 'is-empty': !displayUrl }">
      <img v-if="displayUrl" :src="displayUrl" alt="应用图标" class="icon-image">
      <span v-else class="icon-placeholder">图标</span>
      <div v-if="uploading" class="icon-uploading">
        <el-icon class="is-loading">
          <Loading />
        </el-icon>
      </div>
    </div>
    <div class="icon-actions">
      <div class="icon-buttons">
        <el-upload
          ref="uploadRef"
          :auto-upload="false"
          :show-file-list="false"
          :accept="ICON_ACCEPT"
          :disabled="uploading"
          :on-change="handleChange"
        >
          <el-button size="small" :loading="uploading">
            {{ modelValue ? '更换图标' : '上传图标' }}
          </el-button>
        </el-upload>
        <el-button
          v-if="modelValue"
          size="small"
          text
          type="danger"
          :disabled="uploading"
          @click="handleRemove"
        >
          移除
        </el-button>
      </div>
      <p class="icon-hint">
        png / jpg / jpeg / webp，≤ 2MB，建议 1:1 比例
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loading } from '@element-plus/icons-vue'
import { ElMessage, type UploadFile, type UploadInstance } from 'element-plus'
import { computed, onBeforeUnmount, ref } from 'vue'

import { issueIconUploadToken } from '@/api/appcenter/app'
import { ICON_ACCEPT, validateIconFile } from '@/views/appcenter/icon-upload'
import { putObject } from '@/views/appcenter/useOssUploader'

const props = defineProps<{
  /** 图标对象键（或历史外部地址）；空串表示未设置 */
  modelValue: string
  /** 编辑回显的签名预览地址（后端 AppVo.iconPreviewUrl） */
  previewUrl?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const uploadRef = ref<UploadInstance>()
const uploading = ref(false)
/** 本次选择的本地预览（objectURL）：上传成功后立即可见，无需等待列表刷新 */
const localPreview = ref('')

const displayUrl = computed(() => localPreview.value || props.previewUrl || '')

onBeforeUnmount(() => revokeLocalPreview())

function revokeLocalPreview(): void {
  if (localPreview.value) {
    URL.revokeObjectURL(localPreview.value)
    localPreview.value = ''
  }
}

async function handleChange(file: UploadFile): Promise<void> {
  const raw = file.raw
  // 不保留内部文件列表：允许重复选择同一文件，也避免 el-upload 自带的列表 UI
  uploadRef.value?.clearFiles()
  if (!raw)
    return
  const invalid = validateIconFile(raw)
  if (invalid) {
    ElMessage.warning(invalid)
    return
  }
  uploading.value = true
  try {
    // 凭证申请失败由 http 层统一提示，此处不重复弹窗
    const token = await issueIconUploadToken(raw.name).catch(() => null)
    if (!token)
      return
    try {
      await putObject(token, token.objectKey, raw)
    }
    catch {
      // ali-oss 直传失败不经 http 拦截器，需在此提示（常见原因：OSS CORS 未放行 / RAM 角色缺 icons/* 授权）
      ElMessage.error('图标上传失败，请重试')
      return
    }
    revokeLocalPreview()
    localPreview.value = URL.createObjectURL(raw)
    emit('update:modelValue', token.objectKey)
    ElMessage.success('图标上传成功')
  }
  finally {
    uploading.value = false
  }
}

function handleRemove(): void {
  revokeLocalPreview()
  emit('update:modelValue', '')
}
</script>

<style scoped>
.icon-upload {
  display: flex;
  align-items: center;
  gap: 16px;
}

.icon-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  overflow: hidden;
  background: var(--apphub-fill-hover, #f5f7fa);
  border: 1px solid var(--apphub-border, #e4e7ed);
  border-radius: 8px;
}

.icon-preview.is-empty {
  border-style: dashed;
}

.icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.icon-placeholder {
  color: var(--apphub-text-secondary, #909399);
  font-size: 12px;
}

.icon-uploading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--apphub-color-primary, #2f8f8a);
  background: rgb(255 255 255 / 72%);
}

.icon-actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.icon-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon-hint {
  margin: 4px 0 0;
  color: var(--apphub-text-secondary, #909399);
  font-size: 12px;
}
</style>
