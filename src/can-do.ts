export type CanDoIcon = 'knowledge' | 'analysis' | 'prediction' | 'inspection' | 'report'

export interface CanDoCapability {
  id: string
  label: string
  description: string
  icon: CanDoIcon
  examples: string[]
}

// 展示文案参考测试用例及用户确认的知识检索问题，不承诺示例中的数据已在每个环境接入。
export const canDoCapabilities: CanDoCapability[] = [
  {
    id: 'knowledge',
    label: '知识问答',
    description: '检索消防规范、电梯检测等运维知识',
    icon: 'knowledge',
    examples: ['地下室防火应满足什么条件', '电梯检测的时候噪声测试怎么执行'],
  },
  {
    id: 'analysis',
    label: '数据分析',
    description: '查看能耗、设备和环境的实时数据与趋势',
    icon: 'analysis',
    examples: [
      '园区现在的用电负荷怎么样？今天总能耗多少？',
      '上周和上个月的用能情况怎么样？',
      '最近30天空气优良率怎么样？污染物浓度趋势如何？',
    ],
  },
  {
    id: 'prediction',
    label: '预测预警',
    description: '识别设备异常、离线状态和潜在风险',
    icon: 'prediction',
    examples: [
      '对A区设备做个批量体检',
      'HVAC-A-001 有没有异常？现在有什么告警？',
      '对B区2号楼的给排水泵做个预测性检查',
    ],
  },
  {
    id: 'inspection',
    label: '巡检上报',
    description: '记录巡检结果，并获取异常处置建议',
    icon: 'inspection',
    examples: [
      '上报一下HVAC-A-001的巡检结果，机组运行有异响且振动明显',
      '3号楼电梯巡检发现异响怎么处理？',
    ],
  },
  {
    id: 'report',
    label: '运维报告',
    description: '按日、周或月汇总园区运维情况',
    icon: 'report',
    examples: ['生成今天的运维日报', '给我一份上周的运维周报'],
  },
]
