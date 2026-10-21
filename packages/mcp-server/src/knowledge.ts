// Short, plain-language explanations an agent can relay when the traveller asks "why?".
// Keep claims conservative and population-level; no doses.

export const TOPICS = ['overview', 'light', 'melatonin', 'caffeine', 'naps', 'direction', 'flight', 'safety'] as const;
export type Topic = (typeof TOPICS)[number];

type Language = 'en' | 'zh';

const en: Record<Topic, string> = {
  overview: `# How jet lag works
Your body runs on an internal ~24-hour clock that sets when you feel sleepy, alert and hungry. After crossing time zones, that clock is still on home time, and it only moves by roughly an hour or so per day.

The plan tracks one marker of that clock: the core body temperature minimum (CBTmin), usually about 2-3 hours before your normal wake time. Timing light, sleep, meals and caffeine around it lets you move the clock in the right direction as fast as the body allows.

- Shifting earlier ("advancing", usually after flying east) is slower, roughly 1 hour per day.
- Shifting later ("delaying", usually after flying west) is faster, roughly 1-1.5 hours per day.

These are population averages; individuals vary.`,
  light: `# Light: the main lever
Light is the strongest signal to the body clock, and its effect depends on timing relative to CBTmin:
- Light in the hours **after** CBTmin shifts the clock **earlier**.
- Light in the hours **before** CBTmin shifts the clock **later**.
- The same light at the wrong time pushes the clock the wrong way, which is why the plan sometimes says to avoid light, even outdoors in the morning.

Outdoor daylight is far brighter than indoor lighting, even on a cloudy day. To avoid light, wear dark sunglasses outside and keep indoor lights dim. On a plane, use the window shade or an eye mask.`,
  melatonin: `# Melatonin
Melatonin is the hormone your body releases in the evening. Taken in the late afternoon or evening, before your body's own release, it can help shift the clock earlier, which is why the plan only suggests it when advancing. It can also make it easier to fall asleep at a new bedtime.

Timing matters more than amount. The plan never gives a dose: follow the product label or ask a clinician. Rules differ by country (it is prescription-only in some, such as the UK), product quality varies, and it is not suitable for everyone, including during pregnancy or breastfeeding or alongside some medications.`,
  caffeine: `# Caffeine
Caffeine blocks the build-up of sleepiness. Its effects last many hours (it takes roughly 5 hours, and for some people much longer, to clear half of a dose), so caffeine late in the day can make it hard to sleep at the planned time.

Using caffeine in the morning or early afternoon of your new schedule is fine and can help you stay awake. The plan sets a daily cut-off well before the planned bedtime.`,
  naps: `# Naps
Naps relieve sleepiness but also reduce the "sleep pressure" you need to fall asleep at the new bedtime. If you must nap, keep it short (about 20-30 minutes), early in the afternoon of local time, and never in the no-nap window before bed. Set an alarm.`,
  direction: `# Why direction matters
Flying east usually means your clock must move earlier, which the body does slowly. Flying west usually means moving later, which is easier.

For very large eastward trips (around 9-12 hours), it can be quicker to go "the long way round" and delay the clock instead, for example delaying 14 hours rather than advancing 10. The plan compares both and picks whichever is estimated to finish sooner, and explains the choice in its notes.

Getting light at the wrong time on a big eastward trip can even push the clock in the opposite direction, which is why the avoid-light windows matter.`,
  flight: `# On the flight
- Switch your watch and phone to destination time when you board.
- Sleep during any in-flight sleep window in the plan: eye mask, earplugs, neck support.
- Otherwise stay awake, and use the window shade or screen light to follow the plan's light windows.
- Drink water; limit alcohol, which fragments sleep.
- Caffeine only before the day's cut-off.`,
  safety: `# Safety
- OpenJetLag gives educational guidance based on circadian science, not medical advice.
- Supplements such as melatonin: follow the product label or ask a clinician, especially if pregnant, breastfeeding or taking other medication.
- If you have a sleep disorder, bipolar disorder, an eye condition, or take light-sensitising medication, check with a clinician before using bright-light timing.
- Never drive or operate machinery while drowsy. Safety and work obligations come before the plan.`,
};

const zh: Record<Topic, string> = {
  overview: `# 时差是怎么回事
身体有一个约 24 小时的内部时钟，决定你什么时候困、什么时候清醒、什么时候饿。跨越时区后，这个时钟还停留在出发地时间，每天只能调整大约 1 小时左右。

计划追踪生物钟的一个标志点：核心体温最低点（CBTmin），通常在平时起床前约 2-3 小时。围绕它安排光照、睡眠、饮食和咖啡因，就能让生物钟以身体允许的最快速度往正确方向移动。

- 往早调（"提前"，通常是向东飞）较慢，大约每天 1 小时。
- 往晚调（"推迟"，通常是向西飞）较快，大约每天 1-1.5 小时。

以上是人群平均值，个体差异较大。`,
  light: `# 光照：最重要的调节手段
光是调节生物钟最强的信号，效果取决于相对 CBTmin 的时间：
- 在 CBTmin **之后**几小时见光，生物钟**往早调**。
- 在 CBTmin **之前**几小时见光，生物钟**往晚调**。
- 时间不对的光会把生物钟往反方向推，所以计划有时会让你避光，哪怕是早晨的户外阳光。

户外日光比室内灯光亮得多，阴天也是如此。需要避光时，户外戴深色墨镜，室内调暗灯光；飞机上拉下遮光板或戴眼罩。`,
  melatonin: `# 褪黑素
褪黑素是身体在傍晚分泌的激素。在下午晚些时候或傍晚、身体自身分泌之前服用，有助于把生物钟往早调，所以计划只在"提前"方向时建议使用。它也能帮助你在新的就寝时间入睡。

服用时间比剂量更重要。计划不会给出剂量：请遵循产品说明或咨询医生。各国规定不同（部分国家如英国需要处方），产品质量参差不齐，且并非人人适用，孕期、哺乳期或正在服用某些药物时尤其需要注意。`,
  caffeine: `# 咖啡因
咖啡因会阻断困意的积累，作用持续数小时（代谢掉一半大约需要 5 小时，有些人更久），所以下午晚些时候摄入咖啡因，会让你难以在计划时间入睡。

在新作息的上午或午后早些时候喝咖啡没有问题，还能帮助保持清醒。计划为每天设定了远早于就寝时间的截止点。`,
  naps: `# 午睡
午睡能缓解困倦，但也会消耗在新就寝时间入睡所需的"睡眠压力"。如果必须午睡，请控制在 20-30 分钟左右，安排在当地时间午后早些时候，并且不要落在睡前的"不要午睡"时段内。记得设闹钟。`,
  direction: `# 为什么方向很重要
向东飞通常需要把生物钟往早调，身体做这件事很慢；向西飞通常是往晚调，相对容易。

对于很大的东向时差（约 9-12 小时），"绕远路"反而可能更快，比如推迟 14 小时而不是提前 10 小时。计划会比较两种方向，选择预计更快适应的一种，并在说明中解释原因。

在大幅东向旅行中，错误时间见光甚至可能把生物钟推向相反方向，所以避光时段同样重要。`,
  flight: `# 飞行途中
- 登机后把手表和手机切换到目的地时间。
- 如果计划中有机上睡眠时段，就在那时睡觉：眼罩、耳塞、颈枕。
- 其余时间保持清醒，用遮光板或屏幕光配合计划的光照时段。
- 多喝水，少喝酒，酒精会让睡眠变得零碎。
- 只在当天的咖啡因截止时间之前喝咖啡。`,
  safety: `# 安全提示
- OpenJetLag 提供的是基于生物节律科学的教育性建议，不构成医疗建议。
- 褪黑素等补充剂：请遵循产品说明或咨询医生，孕期、哺乳期或正在服用其他药物者尤其需要注意。
- 如有睡眠障碍、双相情感障碍、眼部疾病，或正在服用光敏性药物，使用强光调节前请先咨询医生。
- 困倦时切勿驾驶或操作机械。安全和工作要求优先于计划。`,
};

export function explain(topic: Topic, language: Language = 'en'): string {
  return (language === 'zh' ? zh : en)[topic];
}
