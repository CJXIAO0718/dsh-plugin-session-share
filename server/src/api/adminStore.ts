// 管理端共享状态：概览数据与忙碌标记。
// mock 与 remote 两种适配器都写进这里，AdminView / SettingsForm 只读这一份。
import { computed, ref } from 'vue'
import type { AdminOverview } from '../admin/types'

export const adminOverviewRef = ref<AdminOverview>({
  totals: {
    shares: 0,
    published: 0,
    revoked: 0,
    users: 0,
    activeUsers: 0,
    storageBytes: 0,
    views: 0,
  },
  activity: [],
  recent: [],
  users: [],
})

export const adminBusy = ref(false)

export const adminOverview = computed(() => adminOverviewRef.value)
