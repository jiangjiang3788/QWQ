// 在 SullyOS 页面打开开发者工具 Console 后粘贴执行。
// 只读取 characters store 中阿沉的 impression，并复制为 JSON；不修改任何数据。
(async () => {
  try {
    const infos = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    for (const info of infos) {
      if (!info.name) continue;
      const database = await new Promise((resolve, reject) => {
        const req = indexedDB.open(info.name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!database.objectStoreNames.contains('characters')) { database.close(); continue; }
      const rows = await new Promise((resolve, reject) => {
        const tx = database.transaction('characters', 'readonly');
        const req = tx.objectStore('characters').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      database.close();
      const character = rows.find(item => item && (item.id === 'char-1783845231600-sb9jbi8rx' || item.name === '阿沉'));
      if (character && character.impression) {
        const text = JSON.stringify(character.impression, null, 2);
        console.log('[阿沉 impression]', text);
        try { await navigator.clipboard.writeText(text); } catch (_) {}
        alert('已找到阿沉 impression。JSON 已输出到控制台，并尝试复制到剪贴板。');
        return;
      }
    }
    alert('没有在 IndexedDB 的 characters store 中找到阿沉 impression。当前完整备份里该字段也是 null。');
  } catch (error) {
    console.error(error);
    alert(`读取失败：${error.message || error}`);
  }
})();
