<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  ContactRound,
  FileBarChart2,
  FileText,
  Home,
  Landmark,
  LayoutGrid,
  MapPin,
  MessageSquareText,
  PackageCheck,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  Warehouse,
} from 'lucide-vue-next'
import PortalAssistantWidget from './components/PortalAssistantWidget.vue'

type Navigation = '首页' | 'AI智能' | '数据统计' | '通讯录'
const navigation: Array<{ label: Navigation; icon: typeof Home }> = [
  { label: '首页', icon: Home },
  { label: 'AI智能', icon: Sparkles },
  { label: '数据统计', icon: BarChart3 },
  { label: '通讯录', icon: ContactRound },
]
const activeNavigation = ref<Navigation>('首页')
const noticeFilter = ref('全部类型')
const noticeKeyword = ref('')
const selectedDay = ref(12)
const demoNotice = ref('')
let noticeTimer: ReturnType<typeof setTimeout>
function showDemoNotice(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest('button')
  if (
    !target ||
    target.closest('.portal-assistant') ||
    target.closest('.portal-days') ||
    target.closest('.portal-navigation')
  )
    return
  demoNotice.value = `${target.textContent?.trim() || target.getAttribute('aria-label') || '此功能'}为门户演示，暂未接入业务数据。`
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (demoNotice.value = ''), 2800)
}
onBeforeUnmount(() => clearTimeout(noticeTimer))

const notices = [
  { category: '门户发布', title: '罗山科技园 2026 年第四季度重点工作安排', date: '10-10' },
  { category: '服务系统发布', title: '园区综合运维平台巡检模块更新通知', date: '10-09' },
  { category: '运营通知', title: '园区能源管理月度数据归集提醒', date: '10-08' },
  { category: '门户发布', title: '关于开展企业安全生产自查的通知', date: '10-08' },
  { category: '服务系统发布', title: '访客预约与门禁授权流程说明', date: '10-07' },
  { category: '运营通知', title: '十月园区公共区域维护计划', date: '10-07' },
]

const quickApps = [
  { label: '产品分析', icon: FileBarChart2, color: 'cyan' },
  { label: '账号管理', icon: UserRound, color: 'blue' },
  { label: '房源管理', icon: Building2, color: 'indigo' },
  { label: '租赁费用管理', icon: CircleDollarSign, color: 'violet' },
  { label: '物业合同', icon: FileText, color: 'sky' },
  { label: '账单管理', icon: ClipboardCheck, color: 'blue' },
  { label: '结算管理', icon: Landmark, color: 'cyan' },
  { label: '押金管理', icon: ShieldCheck, color: 'indigo' },
]

const oaItems = [
  {
    level: '紧急',
    kind: '财务',
    title: '【付款流程】办公设备采购费用支付审批',
    owner: '周鹏',
    time: '2026.10.12 09:00:00',
  },
  {
    level: '急',
    kind: '采购',
    title: '【请购流程】园区三期备品备件采购申请',
    owner: '林思远',
    time: '2026.10.12 08:45:00',
  },
  {
    level: '一般',
    kind: '合同',
    title: '【合同流程】年度运维服务合同续签审批',
    owner: '李静',
    time: '2026.10.11 16:20:00',
  },
]

const scheduleItems = [
  {
    time: '09:00–10:00',
    title: '园区运维周例会',
    note: 'A3 会议室 · 物业运维组',
    icon: CalendarDays,
  },
  {
    time: '14:30–15:30',
    title: '设备告警复盘会',
    note: '线上会议 · 数据运营组',
    icon: MessageSquareText,
  },
]

const filteredNotices = computed(() => {
  const keyword = noticeKeyword.value.trim()
  return notices.filter(
    (notice) =>
      (noticeFilter.value === '全部类型' || notice.category === noticeFilter.value) &&
      (!keyword || notice.title.includes(keyword)),
  )
})

function selectNavigation(label: Navigation) {
  if (label === 'AI智能') {
    window.location.href = '/'
    return
  }
  activeNavigation.value = label
}
</script>

<template>
  <div class="portal-demo" data-testid="portal-demo" @click="showDemoNotice">
    <header class="portal-topbar">
      <div class="portal-topbar-inner">
        <a
          class="portal-logo"
          href="#"
          aria-label="罗山科技园首页"
          @click.prevent="selectNavigation('首页')"
        >
          <span class="portal-logo-mark">
            <span></span>
            <span></span>
          </span>
          <span>罗山科技园</span>
        </a>
        <nav class="portal-navigation" aria-label="门户导航">
          <button
            v-for="item in navigation"
            :key="item.label"
            type="button"
            :class="{ active: activeNavigation === item.label }"
            @click="selectNavigation(item.label)"
          >
            <component :is="item.icon" :size="18" />
            {{ item.label }}
          </button>
        </nav>
        <div class="portal-user-actions">
          <button type="button" aria-label="消息通知" class="portal-notification">
            <Bell :size="19" />
            <i></i>
          </button>
          <span></span>
          <button type="button" aria-label="用户中心" class="portal-avatar">
            <UserRound :size="22" />
          </button>
        </div>
      </div>
    </header>

    <main class="portal-main">
      <div class="portal-page-heading">
        <div>
          <p>LUOSHAN SCIENCE PARK</p>
          <h1>{{ activeNavigation }}</h1>
        </div>
        <span>
          <Sparkles :size="14" />
          门户演示数据
        </span>
      </div>

      <section class="portal-grid" aria-label="园区门户仪表盘">
        <div class="portal-stack portal-left-column">
          <article class="portal-card portal-profile-card">
            <div class="portal-profile-no">NO. 00239</div>
            <div class="portal-profile-avatar">晨</div>
            <div class="portal-profile-copy">
              <div>
                <strong>陈晨</strong>
                <span>祝您开心每一天！</span>
              </div>
              <p>
                罗山科技园开发运营服务有限公司
                <br />
                运营管理部
              </p>
            </div>
            <div class="portal-profile-orb"></div>
          </article>

          <article class="portal-card portal-calendar-card">
            <div class="portal-card-title">
              <CalendarDays :size="18" />
              <strong>任务日程</strong>
              <ClipboardCheck :size="20" />
            </div>
            <div class="portal-calendar-heading">
              <strong>2026.10.12</strong>
              <button type="button">
                2026年10月
                <CalendarDays :size="15" />
              </button>
              <div>
                <ChevronLeft :size="17" />
                <span>今日</span>
                <ChevronRight :size="17" />
              </div>
            </div>
            <div class="portal-weekdays">
              <span v-for="week in ['一', '二', '三', '四', '五', '六', '日']" :key="week">
                {{ week }}
              </span>
            </div>
            <div class="portal-days">
              <span v-for="day in 3" :key="`empty-${day}`"></span>
              <button
                v-for="day in 31"
                :key="day"
                type="button"
                :class="{ selected: day === selectedDay, marked: [6, 11, 15, 23].includes(day) }"
                @click="selectedDay = day"
              >
                {{ day }}
              </button>
            </div>
          </article>

          <article class="portal-card portal-schedule-card">
            <div class="portal-card-title">
              <Clock3 :size="18" />
              <strong>我的日程</strong>
              <button type="button">
                查看全部
                <ChevronRight :size="15" />
              </button>
            </div>
            <div class="portal-schedule-list">
              <div v-for="item in scheduleItems" :key="item.title" class="portal-schedule-item">
                <span class="portal-schedule-dot"></span>
                <div class="portal-schedule-time">{{ item.time }}</div>
                <div class="portal-schedule-icon"><component :is="item.icon" :size="18" /></div>
                <div>
                  <strong>{{ item.title }}</strong>
                  <small>{{ item.note }}</small>
                </div>
              </div>
            </div>
          </article>
        </div>

        <article class="portal-card portal-notice-card">
          <div class="portal-card-title">
            <Bell :size="18" />
            <strong>通知公告</strong>
            <button type="button">
              全部
              <ChevronRight :size="15" />
            </button>
          </div>
          <div class="portal-notice-toolbar">
            <select v-model="noticeFilter" class="portal-select" aria-label="通知类型">
              <option
                v-for="type in ['全部类型', '门户发布', '服务系统发布', '运营通知']"
                :key="type"
              >
                {{ type }}
              </option>
            </select>
            <label>
              <Search :size="16" />
              <input v-model="noticeKeyword" placeholder="标题 / 地点备注 / 人员" />
            </label>
          </div>
          <div class="portal-notice-list">
            <div v-for="notice in filteredNotices" :key="notice.title" class="portal-notice-item">
              <i></i>
              <span>{{ notice.category }}</span>
              <strong>{{ notice.title }}</strong>
              <time>{{ notice.date }}</time>
            </div>
            <p v-if="!filteredNotices.length" class="portal-empty">暂无匹配通知</p>
          </div>
        </article>

        <article class="portal-card portal-quick-card">
          <div class="portal-card-title">
            <LayoutGrid :size="18" />
            <strong>快捷功能</strong>
            <button type="button">
              管理
              <ChevronRight :size="15" />
            </button>
          </div>
          <div class="portal-quick-grid">
            <button
              v-for="app in quickApps"
              :key="app.label"
              type="button"
              class="portal-quick-app"
            >
              <span class="portal-quick-icon" :class="app.color">
                <component :is="app.icon" :size="23" />
              </span>
              <span>{{ app.label }}</span>
            </button>
          </div>
        </article>

        <article class="portal-card portal-oa-card">
          <div class="portal-card-title">
            <ClipboardCheck :size="18" />
            <strong>OA流程中心</strong>
            <div class="portal-oa-tabs">
              <button class="active" type="button">待办流程·2</button>
              <button type="button">已办流程·1</button>
              <button type="button">我发起的·1</button>
            </div>
            <button type="button">
              更多
              <ChevronRight :size="15" />
            </button>
          </div>
          <div class="portal-oa-filters">
            <label>
              <Search :size="16" />
              <input placeholder="搜索流程标题 / 发起人" />
            </label>
            <button type="button">
              全部类型
              <ChevronDown :size="15" />
            </button>
            <button type="button">
              全部优先级
              <ChevronDown :size="15" />
            </button>
          </div>
          <div class="portal-oa-list">
            <div v-for="item in oaItems" :key="item.title" class="portal-oa-item">
              <div class="portal-oa-meta">
                <span :class="item.level">{{ item.level }}</span>
                <span>{{ item.kind }}</span>
              </div>
              <div class="portal-oa-copy">
                <strong>{{ item.title }}</strong>
                <small>发起人：{{ item.owner }}　 {{ item.time }}</small>
              </div>
              <button type="button">去处理</button>
            </div>
          </div>
        </article>

        <article class="portal-card portal-applications-card">
          <div class="portal-card-title">
            <Warehouse :size="18" />
            <strong>我的应用</strong>
            <button type="button">
              门户应用
              <ChevronRight :size="15" />
            </button>
          </div>
          <div class="portal-app-tabs">
            <button class="active" type="button">智慧运营</button>
            <button type="button">智慧服务</button>
            <button type="button">智慧办公</button>
            <button type="button">智慧管理</button>
          </div>
          <div class="portal-application-list">
            <button type="button">
              <MapPin :size="24" />
              <span>园区资源图谱</span>
            </button>
            <button type="button">
              <PackageCheck :size="24" />
              <span>物料工单</span>
            </button>
            <button type="button">
              <Settings2 :size="24" />
              <span>设备台账</span>
            </button>
          </div>
        </article>
      </section>
    </main>

    <div v-if="demoNotice" class="portal-demo-toast" role="status">{{ demoNotice }}</div>
    <PortalAssistantWidget />
  </div>
</template>
