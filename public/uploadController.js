export function createUploadController(deps) {
  const {
    state,
    apiFetchJson,
    render,
    renderComposer,
    addThreadNotice,
    withAuthTokenQuery,
    getAttachmentFileName,
    buildUploadPreviewUrl,
    getComposerAttachments,
    setComposerAttachments,
    getComposerUploadCount,
    setComposerUploadCount,
  } = deps;

  function incrementUploadCount(threadId, delta) {
    setComposerUploadCount(threadId, Math.max(0, getComposerUploadCount(threadId) + delta));
  }

  async function uploadComposerImageFiles(fileList) {
    const threadId = state.activeThreadId;
    if (!threadId) {
      return;
    }

    const files = Array.from(fileList || []).filter((file) => file && String(file.type || '').startsWith('image/'));
    if (!files.length) {
      return;
    }

    incrementUploadCount(threadId, files.length);
    renderComposer();

    const uploaded = [];
    try {
      for (const file of files) {
        const result = await apiFetchJson('/api/uploads/image', {
          method: 'POST',
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-upload-filename': encodeURIComponent(file.name || 'image'),
          },
          body: await file.arrayBuffer(),
        });
        uploaded.push({
          type: 'localImage',
          path: result.filePath,
          name: result.name || file.name || getAttachmentFileName(result.filePath),
          previewUrl: result.url ? withAuthTokenQuery(result.url) : buildUploadPreviewUrl(result.filePath),
        });
        incrementUploadCount(threadId, -1);
        renderComposer();
      }
    } catch (error) {
      if (uploaded.length) {
        setComposerAttachments(threadId, getComposerAttachments(threadId).concat(uploaded));
      }
      incrementUploadCount(threadId, -Math.max(1, files.length - uploaded.length));
      addThreadNotice(threadId, `图片上传失败：${error.message || '请稍后重试。'}`, '_error');
      render();
      return;
    }

    if (uploaded.length) {
      setComposerAttachments(threadId, getComposerAttachments(threadId).concat(uploaded));
    }
    renderComposer();
  }

  return {
    uploadComposerImageFiles,
  };
}
