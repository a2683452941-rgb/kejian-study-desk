// API 封装：统一错误对象 {message, code, status, extra}
async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw { message: '网络连接失败，请检查网络后重试', code: 'network', status: 0 };
  }
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    throw { message: data.error || '请求失败，请重试', code: data.code, status: res.status, extra: data, latest: data.latest };
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};

// 上传（XHR：进度 + 可取消），返回 Promise 与 abort 句柄
export function uploadFile({ file, ownerType, ownerId, category, title, mode, resourceId, forceNew, onProgress }) {
  const xhr = new XMLHttpRequest();
  const params = new URLSearchParams({
    name: file.name, size: String(file.size), ownerType, ownerId,
    category: category || 'other', mode: mode || 'new',
  });
  if (title) params.set('title', title);
  if (resourceId) params.set('resourceId', resourceId);
  if (forceNew) params.set('forceNew', '1');
  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', '/api/upload?' + params.toString());
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject({ message: data.error || '上传失败，请重试', code: data.code, status: xhr.status, extra: data });
    };
    xhr.onerror = () => reject({ message: '网络中断，上传失败，可重试', code: 'network', status: 0 });
    xhr.onabort = () => reject({ message: '已取消', code: 'cancelled', status: 0 });
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}