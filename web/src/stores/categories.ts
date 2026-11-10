import { defineStore } from 'pinia';
import { ref } from 'vue';
import { categoriesApi } from '@/api';

// 模板分类：存数据库，可在「模板管理」里增删改
// 组件里用 catMeta(name) 取某个分类的图标+颜色
export const useCategoriesStore = defineStore('categories', () => {
  const list = ref<any[]>([]);
  const loaded = ref(false);
  const loading = ref(false);

  async function load(force = false) {
    if ((loaded.value && !force) || loading.value) return;
    loading.value = true;
    try {
      list.value = await categoriesApi.list();
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  function catMeta(name: string): { emoji: string; color: string } {
    const c = list.value.find((x) => x.name === name);
    return c ? { emoji: c.emoji, color: c.color } : { emoji: '📁', color: '#64748b' };
  }

  return { list, loaded, load, catMeta };
});
