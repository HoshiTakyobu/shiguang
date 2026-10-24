const DAY = 86400000;
export function projectState(packet, elapsed = 0) {
  if (!packet?.state) return null;
  const s = packet.state, age = Math.max(0, packet.serverNow - s.receivedAt + elapsed);
  const online = packet.online && age < packet.offlineAfter;
  const delta = online && s.mode === 'working' ? age : 0;
  let todayMs = s.todayMs, monthMs = s.monthMs, todayKey = s.todayKey, month = s.month;
  const untilMidnight = Math.max(0, s.dayEndsAt - s.now);
  if (delta < untilMidnight) {
    const counted = Math.min(delta, DAY - todayMs); todayMs += counted; monthMs += counted;
  } else if (delta > 0) {
    const date = new Date(`${s.todayKey}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); todayKey = date.toISOString().slice(0, 10);
    todayMs = Math.min(DAY, delta - untilMidnight);
    monthMs = s.now + delta >= s.monthEndsAt ? todayMs : monthMs + Math.min(untilMidnight, DAY - s.todayMs) + todayMs;
    month = todayKey.slice(0, 7);
  }
  const g = s.goals;
  const bonuses = g.bonuses ?? [{ id: 'bonus-1', hours: g.bonusHours, amount: g.bonusAmount }];
  const milestones = [{ id: 'base', hours: g.baseHours, amount: g.baseAmount, bonusIndex: 0 },
    ...(g.bonusEnabled ? bonuses.map((tier, index) => ({ ...tier, bonusIndex: index + 1 })) : [])]
    .map(tier => ({ ...tier, reached: monthMs >= Math.round(tier.hours * 3600000) }));
  const targetMilestone = milestones.find(tier => !tier.reached) ?? milestones.at(-1);
  const achievedMilestone = milestones.findLast(tier => tier.reached) ?? null;
  const target = targetMilestone.hours;
  return { ...s, online, age, todayMs, monthMs, todayKey, month, milestones, targetMilestone, achievedMilestone,
    baseReached: milestones[0].reached, bonusReached: milestones.slice(1).some(tier => tier.reached), allReached: milestones.every(tier => tier.reached), target,
    remaining: Math.max(0, Math.round(target * 3600000) - monthMs), amount: targetMilestone.amount };
}
export function formatTime(ms) { const total = Math.floor(ms / 1000); return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60].map(x => String(x).padStart(2, '0')).join(':'); }
export function amount(value) { return value.toFixed(2).replace(/(\.\d)0$/, '$1'); }
